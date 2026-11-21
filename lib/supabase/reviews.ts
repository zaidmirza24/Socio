"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";
import { processCaption } from "@/lib/matching/normalizer.ts";
import { fetchSinglePostDetails } from "@/lib/services/scraper-orchestrator";
import { formatDate } from "@/lib/utils";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { PlatformType, ReviewStatus } from "@/types/database";

/** Supabase returns a to-one embed as an object, or as an array without generated types. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface CaptionEmbed {
  title: string | null;
  canonical_caption: string | null;
}
interface AccountEmbed {
  handle: string | null;
  volunteer_name: string | null;
}
interface ReviewQueueRow {
  id: string;
  caption_id: string;
  account_id: string;
  platform: string;
  platform_post_id: string;
  post_url: string;
  candidate_caption: string;
  similarity_score: number | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  campaign_captions: CaptionEmbed | CaptionEmbed[] | null;
  accounts: AccountEmbed | AccountEmbed[] | null;
}

async function verifyAdminCaller() {
  const authClient = createServerComponentClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return { authorized: false as const, error: "Authentication required." };
  }

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { authorized: false as const, error: "Only administrators can perform this action." };
  }

  return { authorized: true as const, user, adminClient };
}

export interface ReviewQueueDisplayItem {
  id: string;
  captionId: string;
  captionTitle: string;
  canonicalCaption: string;
  accountId: string;
  accountHandle: string;
  volunteerName: string;
  platform: string;
  platformPostId: string;
  postUrl: string;
  candidateCaption: string;
  similarityScore: number;
  status: ReviewStatus;
  createdAt: string;
  reviewedAt: string | null;
}

/**
 * Fetches review queue items with joined caption and volunteer account details.
 */
export async function getReviewQueueItems(
  statusFilter: ReviewStatus | "ALL" = "pending"
): Promise<ReviewQueueDisplayItem[]> {
  // This is a server action (callable as an endpoint) that reads with the service role, so it
  // checks the caller itself instead of relying only on page middleware.
  const authClient = createServerComponentClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return [];

  const supabase = createAdminClient();

  // Paged: the queue passes 1000 rows during the campaign and older pending items would vanish.
  const build = (from: number, to: number) => {
    let query = supabase
    .from("review_queue")
    .select(`
      id,
      caption_id,
      account_id,
      platform,
      platform_post_id,
      post_url,
      candidate_caption,
      similarity_score,
      status,
      created_at,
      reviewed_at,
      campaign_captions (
        title,
        canonical_caption
      ),
      accounts (
        handle,
        volunteer_name
      )
    `)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

    if (statusFilter !== "ALL") {
      query = query.eq("status", statusFilter);
    }
    return query.range(from, to);
  };

  let data: ReviewQueueRow[];
  try {
    data = (await fetchAllRows<unknown>(build)) as ReviewQueueRow[];
  } catch (error: unknown) {
    console.error("Failed to fetch review queue items:", error);
    return [];
  }

  return data.map((item) => {
    const caption = one(item.campaign_captions);
    const account = one(item.accounts);

    return {
      id: item.id,
      captionId: item.caption_id,
      captionTitle: caption?.title ?? "Untitled Campaign",
      canonicalCaption: caption?.canonical_caption ?? "",
      accountId: item.account_id,
      accountHandle: account?.handle ?? "",
      volunteerName: account?.volunteer_name ?? "Unknown Volunteer",
      platform: item.platform,
      platformPostId: item.platform_post_id,
      postUrl: item.post_url,
      candidateCaption: item.candidate_caption,
      similarityScore: typeof item.similarity_score === "number" ? item.similarity_score : 0.9,
      status: item.status as ReviewStatus,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
    };
  });
}

/**
 * Approves a fuzzy match review item:
 * 1. Computes normalized text and SHA-256 hash of the volunteer's variant caption.
 * 2. Caches the variant hash into `caption_approved_variants` so identical future variants auto-match.
 * 3. Fetches live engagement metrics and post metadata from Apify.
 * 4. Moves the post into `matched_posts` with `match_tier = 'manual_approved'` and initiates tracking.
 * 5. Records initial engagement metrics in `metric_snapshots`.
 * 6. Mirrors post and metric snapshot to `posts` and `post_snapshots` so Analytics & KPIs display this approved post.
 * 7. Marks the review item as `approved` and triggers cache revalidation.
 */
export async function approveReviewItem(
  reviewId: string,
  overrideCaptionId?: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminCaller();
  if (!auth.authorized) {
    return { success: false, error: auth.error };
  }

  const supabase = createAdminClient();

  // 1. Fetch review item
  const { data: item, error: fetchError } = await supabase
    .from("review_queue")
    .select("*")
    .eq("id", reviewId)
    .single();

  if (fetchError || !item) {
    return { success: false, error: "Review item not found." };
  }

  const targetCaptionId = overrideCaptionId || item.caption_id;
  const { normalized, hash } = processCaption(item.candidate_caption);
  const now = new Date().toISOString();
  const targetDate = formatDate();

  try {
    // 2. Cache variant hash in caption_approved_variants
    const { error: variantError } = await supabase.from("caption_approved_variants").upsert(
      {
        caption_id: targetCaptionId,
        variant_hash: hash,
        variant_caption: normalized,
        approved_at: now,
        approved_by: auth.user.id,
      },
      {
        onConflict: "variant_hash",
      }
    );
    if (variantError) {
      return { success: false, error: `Failed to save the approved caption variant: ${variantError.message}` };
    }

    // 3. Fetch live metrics from the scraper. Never invent numbers: if the live fetch fails we
    //    stop and let the admin retry, so wrong metrics or a wrong post date are never saved.
    let postDetails = null;
    try {
      postDetails = await fetchSinglePostDetails(item.post_url, item.platform as PlatformType);
    } catch (scraperErr) {
      const reason = scraperErr instanceof Error ? scraperErr.message : String(scraperErr);
      return {
        success: false,
        error: `Could not fetch the live post details, so nothing was approved. Please retry. (${reason})`,
      };
    }

    if (!postDetails || !postDetails.postedAt) {
      return {
        success: false,
        error: "The scraper returned no post details (the post may be private or deleted), so nothing was approved.",
      };
    }

    const postedAt = postDetails.postedAt;
    const mediaType = postDetails.mediaType || "Post";
    const likes = postDetails?.likes ?? null;
    const comments = postDetails?.comments ?? null;
    const views = postDetails?.views ?? null;

    // 4. Move post into matched_posts
    const { data: matchedPost, error: matchError } = await supabase
      .from("matched_posts")
      .upsert(
        {
          caption_id: targetCaptionId,
          account_id: item.account_id,
          platform: item.platform,
          platform_post_id: item.platform_post_id,
          post_url: item.post_url,
          normalized_caption: normalized,
          match_tier: "manual_approved",
          match_confidence: item.similarity_score,
          tracking_status: "tracking",
          posted_at: postedAt,
          last_seen_at: now,
          last_metrics_refresh_at: now,
          thumbnail_url: postDetails?.thumbnailUrl ?? null,
        },
        {
          onConflict: "platform,platform_post_id",
        }
      )
      .select("id")
      .single();

    if (matchError || !matchedPost) {
      return { success: false, error: `Failed to match post: ${matchError?.message ?? "no row returned"}` };
    }

    // 5. Upsert metric_snapshots for matched_posts
    {
      const { error: metricError } = await supabase.from("metric_snapshots").upsert(
        {
          post_id: matchedPost.id,
          snapshot_date: targetDate,
          likes,
          comments,
          views,
          // First snapshot for this matched post: there is nothing to compare with yet.
          delta_likes: null,
          delta_comments: null,
          delta_views: null,
          delta_shares: null,
          source: "direct_url",
          fetched_at: now,
        },
        {
          onConflict: "post_id,snapshot_date",
        }
      );
      if (metricError) {
        return { success: false, error: `Failed to save the post's metrics: ${metricError.message}` };
      }
    }

    // 6. Mirror to legacy posts and post_snapshots so Analytics, KPIs, and Leaderboard display it immediately
    const { data: legacyPost, error: legacyPostError } = await supabase
      .from("posts")
      .upsert(
        {
          account_id: item.account_id,
          platform: item.platform,
          platform_post_id: item.platform_post_id,
          url: item.post_url,
          caption: item.candidate_caption,
          media_type: mediaType,
          posted_at: postedAt,
          last_seen_at: now,
          last_metrics_refresh_at: now,
          thumbnail_url: postDetails?.thumbnailUrl ?? null,
          // Approved: it now counts as a campaign post ("Campaign posts only" view, refresh).
          match_status: "matched",
          matched_caption_id: targetCaptionId,
        },
        {
          onConflict: "platform,platform_post_id",
        }
      )
      .select("id")
      .single();

    if (legacyPostError || !legacyPost) {
      return {
        success: false,
        error: `Failed to save the post for the dashboard: ${legacyPostError?.message ?? "no row returned"}`,
      };
    }

    {
      const { error: postSnapError } = await supabase.from("post_snapshots").upsert(
        {
          post_id: legacyPost.id,
          snapshot_date: targetDate,
          likes,
          comments,
          views,
          shares: null,
          raw_json: postDetails?.rawJson ?? null,
        },
        {
          onConflict: "post_id,snapshot_date",
        }
      );
      if (postSnapError) {
        return { success: false, error: `Failed to save the post's snapshot: ${postSnapError.message}` };
      }
    }

    // 7. Update review_queue status
    const { error: updateError } = await supabase
      .from("review_queue")
      .update({
        caption_id: targetCaptionId,
        status: "approved",
        reviewed_at: now,
        reviewed_by: auth.user.id,
      })
      .eq("id", reviewId);

    if (updateError) {
      return { success: false, error: `Failed to update review status: ${updateError.message}` };
    }

    // 8. Revalidate dashboard caches
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/review");
    revalidatePath("/dashboard/volunteers");

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Rejects a fuzzy match review item:
 * Marks the review item as `rejected` and stops tracking. The post and its engagement history
 * are kept (nothing is discarded), labelled `rejected`, and excluded from engagement refresh.
 */
export async function rejectReviewItem(
  reviewId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminCaller();
  if (!auth.authorized) {
    return { success: false, error: auth.error };
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // 1. Fetch review item
  const { data: item } = await supabase
    .from("review_queue")
    .select("platform, platform_post_id")
    .eq("id", reviewId)
    .single();

  if (!item) {
    return { success: false, error: "Review item not found." };
  }

  // If it was previously tracked as a campaign post, stop tracking it...
  const { error: archiveError } = await supabase
    .from("matched_posts")
    .update({ tracking_status: "archived" })
    .eq("platform", item.platform)
    .eq("platform_post_id", item.platform_post_id);
  if (archiveError) {
    return { success: false, error: `Failed to stop tracking the post: ${archiveError.message}` };
  }

  // ...and label the stored copy 'rejected'. It keeps its engagement history, drops out of
  // "Campaign posts only", and is no longer re-scraped by engagement refresh.
  const { error: labelError } = await supabase
    .from("posts")
    .update({ match_status: "rejected", matched_caption_id: null })
    .eq("platform", item.platform)
    .eq("platform_post_id", item.platform_post_id);
  if (labelError) {
    return { success: false, error: `Failed to label the post as rejected: ${labelError.message}` };
  }

  const { error } = await supabase
    .from("review_queue")
    .update({
      status: "rejected",
      reviewed_at: now,
      reviewed_by: auth.user.id,
    })
    .eq("id", reviewId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/review");

  return { success: true };
}
