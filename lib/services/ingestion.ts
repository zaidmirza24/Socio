import { createAdminClient } from "../supabase/admin.ts";
import { formatDate } from "../utils.ts";
import { applyDayWindowAndCap } from "../utils/day-window.ts";
import { getFeatureSettings } from "./settings.ts";
import type { AdapterResult } from "../collectors/instagram.ts";
import type { PlatformType, RunStatus, ScraperJobType, PostMatchStatus } from "../../types/database.ts";
import {
  matchCaption,
  type MatchableCaption,
  type MatchableVariant,
} from "../matching/matcher.ts";

export interface IngestionOptions {
  actorRunId?: string | null;
  targetDate?: string; // YYYY-MM-DD, defaults to today
  targetedHandles?: string[];
  jobType?: ScraperJobType;
  provider?: string;
  /** Platform the run belongs to (defaults to instagram). Used for audit logging & cost attribution. */
  platform?: PlatformType;
  /** Discovery runs keep only posts made today (IST). Set false for backfills. Default true. */
  enforceDayWindow?: boolean;
  /** Optional max posts kept per account per day. */
  postCapPerAccount?: number | null;
}

export interface IngestionSummary {
  runId: string;
  status: RunStatus;
  accountsProcessed: number;
  postsFound: number;
  postsMatched: number;
  postsDiscarded: number;
  reviewsQueued: number;
  postsUpserted: number; // Aliased to postsMatched for backwards compatibility
  postsNew?: number;
  postsRefreshed?: number;
  snapshotsCreated: number;
  errors: string[];
}

/**
 * Ingests normalized platform data into Supabase Postgres following V2 Architecture:
 * - Match against active campaign captions and approved variants
 * - Exact matches (Tier 1 & approved variants) -> matched_posts & metric_snapshots
 * - Fuzzy matches (Tier 2, similarity >= 0.90) -> review_queue (pending admin review)
 * - Non-matches (similarity < 0.90) -> KEPT in posts/post_snapshots, labelled 'unmatched'
 *   (nothing is ever discarded; every post keeps its engagement history)
 * - Discovery runs only keep posts made today (IST); see applyDayWindowAndCap
 * - Strictly idempotent: rerunning multiple times produces zero duplicate rows
 */
export async function processIngestion(
  data: AdapterResult,
  options: IngestionOptions = {}
): Promise<IngestionSummary> {
  const supabase = createAdminClient();
  const targetDate = options.targetDate ?? formatDate();
  const startTime = new Date().toISOString();
  const errors: string[] = [];

  let postsMatched = 0;
  let postsDiscarded = 0;
  let reviewsQueued = 0;
  let snapshotsCreated = 0;

  // 1. Check or initialize collection_run audit record
  let runId: string;
  let targetedHandlesFromRun: string[] | null = options.targetedHandles ?? null;

  if (options.actorRunId) {
    const { data: existingRun } = await supabase
      .from("collection_runs")
      .select("id, error")
      .eq("actor_run_id", options.actorRunId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRun) {
      runId = existingRun.id;
      if (!targetedHandlesFromRun && existingRun.error && typeof existingRun.error === "object") {
        const errObj = existingRun.error as Record<string, unknown>;
        if (Array.isArray(errObj.targeted_handles)) {
          targetedHandlesFromRun = errObj.targeted_handles as string[];
        }
      }
    } else {
      const { data: runRecord, error: runInitError } = await supabase
        .from("collection_runs")
        .insert({
          actor_run_id: options.actorRunId,
          platform: options.platform || "instagram",
          provider: options.provider || "apify",
          job_type: options.jobType || "discovery",
          started_at: startTime,
          status: "started",
          accounts_targeted: data.accounts.size,
          posts_found: data.posts.length,
          posts_upserted: 0,
          snapshots_created: 0,
        })
        .select("id")
        .single();
      runId = runRecord?.id ?? "local-run-" + Date.now();
      if (runInitError) {
        errors.push(`Failed to initialize collection_run: ${runInitError.message}`);
      }
    }
  } else {
    const { data: runRecord, error: runInitError } = await supabase
      .from("collection_runs")
      .insert({
        actor_run_id: null,
        platform: options.platform || "instagram",
        provider: options.provider || "apify",
        job_type: options.jobType || "discovery",
        started_at: startTime,
        status: "started",
        accounts_targeted: data.accounts.size,
        posts_found: data.posts.length,
        posts_upserted: 0,
        snapshots_created: 0,
      })
      .select("id")
      .single();
    runId = runRecord?.id ?? "local-run-" + Date.now();
    if (runInitError) {
      errors.push(`Failed to initialize collection_run: ${runInitError.message}`);
    }
  }

  try {
    // 1b. Daily discovery only counts posts made today (IST). The window is also enforced here
    // because not every actor honours its date input (e.g. X). Refresh runs target older posts
    // on purpose, so they are never windowed.
    if ((options.jobType ?? "discovery") === "discovery" && options.enforceDayWindow !== false) {
      const { kept, dropped } = applyDayWindowAndCap(data.posts, options.postCapPerAccount ?? null);
      if (dropped > 0) {
        console.log(`[ingestion] Day window dropped ${dropped} of ${data.posts.length} posts not made today (IST).`);
      }
      data = { ...data, posts: kept };
    }

    // 2. Fetch active campaign captions & approved variants for matching
    const { data: activeCaptionsRaw, error: captionsError } = await supabase
      .from("campaign_captions")
      .select("id, caption_hash, canonical_caption, normalized_caption, released_at")
      .eq("status", "active");

    if (captionsError) {
      throw new Error(`Failed to query campaign captions: ${captionsError.message}`);
    }

    const activeCaptions: MatchableCaption[] = (activeCaptionsRaw || []).map((c) => ({
      id: c.id,
      caption_hash: c.caption_hash,
      canonical_caption: c.canonical_caption,
      normalized_caption: c.normalized_caption,
      released_at: c.released_at,
    }));

    const { data: approvedVariantsRaw, error: variantsError } = await supabase
      .from("caption_approved_variants")
      .select("caption_id, variant_hash");

    if (variantsError) {
      errors.push(`Warning: failed to query approved caption variants: ${variantsError.message}`);
    }

    const approvedVariants: MatchableVariant[] = (approvedVariantsRaw || []).map((v) => ({
      caption_id: v.caption_id,
      variant_hash: v.variant_hash,
    }));

    // Fetch existing review queue items to preserve human review decisions
    const { data: existingReviewsRaw } = await supabase
      .from("review_queue")
      .select("platform, platform_post_id, status");

    const existingReviewStatusMap = new Map<string, string>();
    for (const r of existingReviewsRaw || []) {
      existingReviewStatusMap.set(`${r.platform}:${r.platform_post_id}`, r.status);
    }

    // 3. Fetch all active monitored accounts across platforms
    const { data: allMonitoredAccounts, error: accountFetchError } = await supabase
      .from("accounts")
      .select("id, handle, platform, is_visible")
      .eq("status", "active");

    if (accountFetchError) {
      throw new Error(`Failed to query accounts: ${accountFetchError.message}`);
    }

    const accountIdMap = new Map<string, string>();
    for (const acc of allMonitoredAccounts ?? []) {
      const handleLower = acc.handle.toLowerCase();
      // Platform-qualified lookup key
      accountIdMap.set(`${acc.platform}:${handleLower}`, acc.id);
      // Bare handle fallback for legacy / single-platform callers
      if (!accountIdMap.has(handleLower)) {
        accountIdMap.set(handleLower, acc.id);
      }
    }

    // 4. Update account visibility and last_checked_at
    const checkedNow = new Date().toISOString();
    const returnedHandles = new Set(Array.from(data.accounts.keys()).map((h) => h.toLowerCase()));
    const returnedPlatformHandles = new Set(
      Array.from(data.accounts.entries()).map(([h, m]) => `${m.platform}:${h.toLowerCase()}`)
    );
    const visibleAccountIds: string[] = [];
    const invisibleAccountIds: string[] = [];

    const targetedSet = targetedHandlesFromRun
      ? new Set(targetedHandlesFromRun.map((h) => h.toLowerCase()))
      : null;

    for (const acc of allMonitoredAccounts ?? []) {
      const handleLower = acc.handle.toLowerCase();
      const platformHandle = `${acc.platform}:${handleLower}`;
      const isReturned = returnedPlatformHandles.has(platformHandle) || returnedHandles.has(handleLower);

      if (isReturned) {
        visibleAccountIds.push(acc.id);
      } else if (targetedSet && (targetedSet.has(handleLower) || targetedSet.has(platformHandle))) {
        // Was explicitly targeted in this run, but returned 0 items / was private
        invisibleAccountIds.push(acc.id);
      }
    }

    if (visibleAccountIds.length > 0) {
      await supabase
        .from("accounts")
        .update({
          is_visible: true,
          last_checked_at: checkedNow,
        })
        .in("id", visibleAccountIds);
    }

    if (invisibleAccountIds.length > 0) {
      await supabase
        .from("accounts")
        .update({
          is_visible: false,
          last_checked_at: checkedNow,
        })
        .in("id", invisibleAccountIds);
    }

    // 5. Upsert account snapshots
    for (const [handle, metrics] of Array.from(data.accounts.entries())) {
      const handleLower = handle.toLowerCase();
      const accountId =
        accountIdMap.get(`${metrics.platform}:${handleLower}`) ?? accountIdMap.get(handleLower);
      if (!accountId) continue;

      const { error: accSnapshotError } = await supabase
        .from("account_snapshots")
        .upsert(
          {
            account_id: accountId,
            snapshot_date: targetDate,
            followers: metrics.followers,
            following: metrics.following,
            post_count: metrics.post_count,
          },
          {
            onConflict: "account_id,snapshot_date",
          }
        );

      if (accSnapshotError) {
        errors.push(`Failed to upsert snapshot for account ${handle}: ${accSnapshotError.message}`);
      }
    }

    // Upserts a post + today's snapshot into posts/post_snapshots (idempotent).
    // Returns true when the snapshot was written; failures are recorded in `errors`
    // so a post can never be silently "tracked" yet missing from the dashboard.
    // `label` sets the caption-match label. When omitted the existing label is left untouched
    // (a new post starts as 'unmatched' via the column default).
    const mirrorToPosts = async (
      post: AdapterResult["posts"][number],
      accountId: string,
      label?: { matchStatus: PostMatchStatus; captionId: string | null }
    ): Promise<boolean> => {
      try {
        const nowIso = new Date().toISOString();
        const { data: legacyPost, error: postErr } = await supabase
          .from("posts")
          .upsert(
            {
              account_id: accountId,
              platform: post.platform,
              platform_post_id: post.platform_post_id,
              url: post.url,
              caption: post.caption,
              media_type: post.media_type,
              posted_at: post.posted_at,
              last_seen_at: nowIso,
              last_metrics_refresh_at: nowIso,
              thumbnail_url: post.thumbnail_url ?? null,
              ...(label
                ? { match_status: label.matchStatus, matched_caption_id: label.captionId }
                : {}),
            },
            {
              onConflict: "platform,platform_post_id",
            }
          )
          .select("id")
          .single();

        if (!legacyPost) {
          errors.push(
            `Failed to save post ${post.platform_post_id} for the dashboard: ${postErr?.message ?? "no row returned"}`
          );
          return false;
        }

        const { error: snapErr } = await supabase.from("post_snapshots").upsert(
          {
            post_id: legacyPost.id,
            snapshot_date: targetDate,
            likes: post.metrics.likes,
            comments: post.metrics.comments,
            shares: post.metrics.shares,
            views: post.metrics.views,
            quotes: post.metrics.quotes ?? null,
            raw_json: post.raw_json,
          },
          {
            onConflict: "post_id,snapshot_date",
          }
        );
        if (snapErr) {
          errors.push(
            `Failed to save snapshot for post ${post.platform_post_id}: ${snapErr.message}`
          );
          return false;
        }
        return true;
      } catch (err: unknown) {
        errors.push(
          `Failed to mirror post ${post.platform_post_id}: ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
    };

    // Feature flag: when Campaign Captions is OFF, skip matching and keep every post.
    // When ON, every post is STILL kept (with its engagement history); matching only labels it
    // matched / needs review / not matched.
    const { campaign_captions_enabled: captionMatchingEnabled } = await getFeatureSettings();

    // 6. Process posts through the Matching Engine (labels, never discards)
    const processPost = async (post: AdapterResult["posts"][number]): Promise<void> => {
      const handleLower = post.account_handle.toLowerCase();
      const accountId =
        accountIdMap.get(`${post.platform}:${handleLower}`) ?? accountIdMap.get(handleLower);
      if (!accountId) {
        // Unknown handle (tagged user, related profile, etc.) -> silently skip
        return;
      }

      // Execute Two-Tier Matching Pipeline with Temporal Embargo Validation
      const matchResult = matchCaption(post.caption, activeCaptions, approvedVariants, {
        postedAt: post.posted_at,
        // Daily captions: a post only matches the caption released on the same (IST) day.
        sameDayOnly: true,
      });

      // Capture-everything mode (Campaign Captions OFF): exact matches still take the normal
      // matched path below; every other post (no match / fuzzy) is stored unfiltered in `posts`.
      if (!captionMatchingEnabled && !(matchResult.matched && !matchResult.needsReview)) {
        if (await mirrorToPosts(post, accountId)) {
          postsMatched++;
          snapshotsCreated++;
        }
        return;
      }

      // --- CASE 1: No caption match -> keep the post, labelled 'unmatched' ---
      if (!matchResult.matched) {
        if (await mirrorToPosts(post, accountId, { matchStatus: "unmatched", captionId: null })) {
          postsMatched++;
          snapshotsCreated++;
        }
        return;
      }

      // --- CASE 2: Tier 2 Fuzzy match (0.90 <= similarity < 1.0) -> REVIEW QUEUE ---
      if (matchResult.needsReview) {
        const postKey = `${post.platform}:${post.platform_post_id}`;
        const existingStatus = existingReviewStatusMap.get(postKey);

        // Guard against the "Review Resurrection Loop":
        // If an admin already rejected this post, respect the decision: it is not re-queued,
        // but the post is still kept and refreshed, labelled 'unmatched'.
        if (existingStatus === "rejected") {
          if (await mirrorToPosts(post, accountId, { matchStatus: "unmatched", captionId: null })) {
            postsMatched++;
            snapshotsCreated++;
          }
          return;
        }

        // If an admin already approved this post it is already tracked: keep refreshing it.
        if (existingStatus === "approved") {
          if (await mirrorToPosts(post, accountId, { matchStatus: "matched", captionId: matchResult.captionId })) {
            postsMatched++;
            snapshotsCreated++;
          }
          return;
        }

        const { error: queueError } = await supabase
          .from("review_queue")
          .upsert(
            {
              caption_id: matchResult.captionId,
              account_id: accountId,
              platform: post.platform,
              platform_post_id: post.platform_post_id,
              post_url: post.url,
              candidate_caption: post.caption ?? "",
              similarity_score: matchResult.confidence,
              status: "pending",
            },
            {
              onConflict: "platform,platform_post_id",
            }
          );

        if (queueError) {
          errors.push(`Failed to queue post ${post.platform_post_id} for review: ${queueError.message}`);
        } else {
          reviewsQueued++;
          existingReviewStatusMap.set(postKey, "pending");
        }
        // Keep the post and its engagement while it waits for review
        if (await mirrorToPosts(post, accountId, { matchStatus: "needs_review", captionId: matchResult.captionId })) {
          postsMatched++;
          snapshotsCreated++;
        }
        return;
      }

      // --- CASE 3: Tier 1 Exact Match or Approved Variant -> MATCHED_POSTS ---
      const nowIso = new Date().toISOString();
      const { data: matchedPost, error: matchedPostError } = await supabase
        .from("matched_posts")
        .upsert(
          {
            caption_id: matchResult.captionId,
            account_id: accountId,
            platform: post.platform,
            platform_post_id: post.platform_post_id,
            post_url: post.url,
            normalized_caption: matchResult.normalizedCaption,
            match_tier: matchResult.tier,
            match_confidence: matchResult.confidence,
            tracking_status: "tracking",
            posted_at: post.posted_at,
            last_seen_at: nowIso,
            last_metrics_refresh_at: nowIso,
            thumbnail_url: post.thumbnail_url ?? null,
          },
          {
            onConflict: "platform,platform_post_id",
          }
        )
        .select("id")
        .single();

      if (matchedPostError || !matchedPost) {
        errors.push(
          `Failed to upsert matched_post ${post.platform_post_id}: ${matchedPostError?.message}`
        );
        return;
      }

      postsMatched++;

      // Compute engagement deltas from previous snapshot
      const { data: prevSnapshot } = await supabase
        .from("metric_snapshots")
        .select("likes, comments, views, shares")
        .eq("post_id", matchedPost.id)
        .lt("snapshot_date", targetDate)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevLikes = prevSnapshot?.likes ?? null;
      const prevComments = prevSnapshot?.comments ?? null;
      const prevViews = prevSnapshot?.views ?? null;
      const prevShares = (prevSnapshot as { shares?: number | null } | null)?.shares ?? null;

      const deltaLikes =
        post.metrics.likes !== null && prevLikes !== null
          ? Math.max(0, post.metrics.likes - prevLikes)
          : 0;
      const deltaComments =
        post.metrics.comments !== null && prevComments !== null
          ? Math.max(0, post.metrics.comments - prevComments)
          : 0;
      const deltaViews =
        post.metrics.views !== null && prevViews !== null
          ? Math.max(0, post.metrics.views - prevViews)
          : 0;
      const deltaShares =
        post.metrics.shares !== null && prevShares !== null
          ? Math.max(0, post.metrics.shares - prevShares)
          : 0;

      // Upsert daily point-in-time metric snapshot
      const snapshotSource = options.jobType === "refresh" ? "weekly_refresh" : "daily_batch";
      const { error: snapshotError } = await supabase
        .from("metric_snapshots")
        .upsert(
          {
            post_id: matchedPost.id,
            snapshot_date: targetDate,
            likes: post.metrics.likes,
            comments: post.metrics.comments,
            views: post.metrics.views,
            shares: post.metrics.shares ?? null,
            delta_likes: deltaLikes,
            delta_comments: deltaComments,
            delta_views: deltaViews,
            delta_shares: deltaShares,
            source: snapshotSource,
            fetched_at: nowIso,
          },
          {
            onConflict: "post_id,snapshot_date",
          }
        );

      if (snapshotError) {
        errors.push(
          `Failed to record metric snapshot for post ${post.platform_post_id}: ${snapshotError.message}`
        );
      } else {
        snapshotsCreated++;
      }

      // Also mirror to legacy posts/post_snapshots for backwards compatibility
      // with current dashboard views
      await mirrorToPosts(post, accountId, { matchStatus: "matched", captionId: matchResult.captionId });
    };

    // Process posts a few at a time: thousands of posts x several DB round-trips each would be
    // slow one-by-one. Every write is an idempotent upsert, so concurrency cannot create
    // duplicates; counters are only touched on the single JS thread.
    const POST_CONCURRENCY = 8;
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < data.posts.length) {
        const post = data.posts[nextIndex++];
        try {
          await processPost(post);
        } catch (postErr: unknown) {
          errors.push(
            `Failed to process post ${post.platform_post_id}: ${postErr instanceof Error ? postErr.message : String(postErr)}`
          );
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(POST_CONCURRENCY, data.posts.length) }, () => worker()));

    // 7. Finalize collection_runs audit record
    const finalStatus: RunStatus = errors.length === 0 ? "success" : "partial";
    await supabase
      .from("collection_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: finalStatus,
        provider: options.provider || "apify",
        job_type: options.jobType || "discovery",
        posts_found: data.posts.length,
        posts_upserted: postsMatched,
        posts_new: options.jobType === "refresh" ? 0 : postsMatched,
        posts_refreshed: options.jobType === "refresh" ? postsMatched : 0,
        snapshots_created: snapshotsCreated,
        error: errors.length > 0 ? { messages: errors } : null,
      })
      .eq("id", runId);

    return {
      runId,
      status: finalStatus,
      accountsProcessed: data.accounts.size,
      postsFound: data.posts.length,
      postsMatched,
      postsDiscarded,
      reviewsQueued,
      postsUpserted: postsMatched,
      postsNew: options.jobType === "refresh" ? 0 : postsMatched,
      postsRefreshed: options.jobType === "refresh" ? postsMatched : 0,
      snapshotsCreated,
      errors,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errors.push(errorMsg);

    await supabase
      .from("collection_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        posts_upserted: postsMatched,
        snapshots_created: snapshotsCreated,
        error: { fatal: errorMsg, messages: errors },
      })
      .eq("id", runId);

    return {
      runId,
      status: "failed",
      accountsProcessed: 0,
      postsFound: data.posts.length,
      postsMatched,
      postsDiscarded,
      reviewsQueued,
      postsUpserted: postsMatched,
      snapshotsCreated,
      errors,
    };
  }
}
