import { createAdminClient } from "../supabase/admin.ts";
import { formatDate } from "../utils.ts";
import type { AdapterResult } from "../collectors/instagram.ts";
import type { RunStatus } from "../../types/database.ts";
import {
  matchCaption,
  type MatchableCaption,
  type MatchableVariant,
} from "../matching/matcher.ts";

export interface IngestionOptions {
  actorRunId?: string | null;
  targetDate?: string; // YYYY-MM-DD, defaults to today
  targetedHandles?: string[];
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
  snapshotsCreated: number;
  errors: string[];
}

/**
 * Ingests normalized platform data into Supabase Postgres following V2 Architecture:
 * - Match against active campaign captions and approved variants
 * - Exact matches (Tier 1 & approved variants) -> matched_posts & metric_snapshots
 * - Fuzzy matches (Tier 2, similarity >= 0.90) -> review_queue (pending admin review)
 * - Non-matches (similarity < 0.90) -> DISCARD IMMEDIATELY (zero storage, zero DB rows)
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
          platform: "instagram",
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
        platform: "instagram",
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

    // 3. Fetch all active monitored accounts for Instagram
    const { data: allMonitoredAccounts, error: accountFetchError } = await supabase
      .from("accounts")
      .select("id, handle, platform, is_visible")
      .eq("platform", "instagram")
      .eq("status", "active");

    if (accountFetchError) {
      throw new Error(`Failed to query accounts: ${accountFetchError.message}`);
    }

    const accountIdMap = new Map<string, string>();
    for (const acc of allMonitoredAccounts ?? []) {
      accountIdMap.set(acc.handle.toLowerCase(), acc.id);
    }

    // 4. Update account visibility and last_checked_at
    const checkedNow = new Date().toISOString();
    const returnedHandles = new Set(Array.from(data.accounts.keys()));
    const visibleAccountIds: string[] = [];
    const invisibleAccountIds: string[] = [];

    const targetedSet = targetedHandlesFromRun
      ? new Set(targetedHandlesFromRun.map((h) => h.toLowerCase()))
      : null;

    for (const acc of allMonitoredAccounts ?? []) {
      const handleLower = acc.handle.toLowerCase();
      if (returnedHandles.has(handleLower)) {
        visibleAccountIds.push(acc.id);
      } else if (targetedSet && targetedSet.has(handleLower)) {
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
      const accountId = accountIdMap.get(handle);
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

    // 6. Process posts through Discard & Matching Engine
    for (const post of data.posts) {
      const accountId = accountIdMap.get(post.account_handle);
      if (!accountId) {
        // Unknown handle (tagged user, related profile, etc.) -> silently skip
        continue;
      }

      // Execute Two-Tier Matching Pipeline with Temporal Embargo Validation
      const matchResult = matchCaption(post.caption, activeCaptions, approvedVariants, {
        postedAt: post.posted_at,
      });

      // --- CASE 1: Below threshold, outside embargo window, or empty -> DISCARD IMMEDIATELY ---
      if (!matchResult.matched) {
        postsDiscarded++;
        // Zero DB rows created for non-matching posts
        continue;
      }

      // --- CASE 2: Tier 2 Fuzzy match (0.90 <= similarity < 1.0) -> REVIEW QUEUE ---
      if (matchResult.needsReview) {
        const postKey = `${post.platform}:${post.platform_post_id}`;
        const existingStatus = existingReviewStatusMap.get(postKey);

        // Guard against the "Review Resurrection Loop":
        // If an admin already rejected this post, respect the decision and discard it.
        if (existingStatus === "rejected") {
          postsDiscarded++;
          continue;
        }

        // If an admin already approved this post, it is already tracked.
        if (existingStatus === "approved") {
          continue;
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
        continue;
      }

      // --- CASE 3: Tier 1 Exact Match or Approved Variant -> MATCHED_POSTS ---
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
            last_seen_at: new Date().toISOString(),
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
        continue;
      }

      postsMatched++;

      // Compute engagement deltas from previous snapshot
      const { data: prevSnapshot } = await supabase
        .from("metric_snapshots")
        .select("likes, comments, views")
        .eq("post_id", matchedPost.id)
        .lt("snapshot_date", targetDate)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const prevLikes = prevSnapshot?.likes ?? null;
      const prevComments = prevSnapshot?.comments ?? null;
      const prevViews = prevSnapshot?.views ?? null;

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

      // Upsert daily point-in-time metric snapshot
      const { error: snapshotError } = await supabase
        .from("metric_snapshots")
        .upsert(
          {
            post_id: matchedPost.id,
            snapshot_date: targetDate,
            likes: post.metrics.likes,
            comments: post.metrics.comments,
            views: post.metrics.views,
            delta_likes: deltaLikes,
            delta_comments: deltaComments,
            delta_views: deltaViews,
            source: "daily_batch",
            fetched_at: new Date().toISOString(),
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
      try {
        const { data: legacyPost } = await supabase
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
              last_seen_at: new Date().toISOString(),
            },
            {
              onConflict: "platform,platform_post_id",
            }
          )
          .select("id")
          .single();

        if (legacyPost) {
          await supabase.from("post_snapshots").upsert(
            {
              post_id: legacyPost.id,
              snapshot_date: targetDate,
              likes: post.metrics.likes,
              comments: post.metrics.comments,
              shares: post.metrics.shares,
              views: post.metrics.views,
              raw_json: post.raw_json,
            },
            {
              onConflict: "post_id,snapshot_date",
            }
          );
        }
      } catch {
        // Non-fatal legacy sync
      }
    }

    // 7. Finalize collection_runs audit record
    const finalStatus: RunStatus = errors.length === 0 ? "success" : "partial";
    await supabase
      .from("collection_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: finalStatus,
        posts_found: data.posts.length,
        posts_upserted: postsMatched,
        snapshots_created: snapshotsCreated,
        error: errors.length > 0 ? { messages: errors } : null,
      })
      .eq("id", runId);

    return {
      runId,
      status: finalStatus,
      accountsProcessed: accountIdMap.size,
      postsFound: data.posts.length,
      postsMatched,
      postsDiscarded,
      reviewsQueued,
      postsUpserted: postsMatched,
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
