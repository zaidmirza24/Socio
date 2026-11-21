import { createAdminClient } from "../supabase/admin.ts";
import { formatDate } from "../utils.ts";
import { applyDayWindowAndCap } from "../utils/day-window.ts";
import { fetchAllRows, chunk } from "../supabase/paginate.ts";
import { growthOrNull, measuredOnly } from "../metrics/integrity.ts";
import { getFeatureSettings } from "./settings.ts";
import { RunGainAccumulator, type RunGain } from "../metrics/run-gain.ts";
import type { AdapterResult } from "../collectors/instagram.ts";
import type { PlatformType, RunStatus, ScraperJobType, PostMatchStatus } from "../../types/database.ts";
import { routePost } from "./post-routing.ts";
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
  /**
   * Instant whose IST calendar day counts as "today" for the discovery day window. Pass the run's
   * start time so a run started late in the evening and saved after midnight keeps its posts.
   * Defaults to now.
   */
  dayWindowAnchor?: Date;
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
  /** Engagement gained on already-tracked posts during this run (new posts are counted separately). */
  gain?: RunGain;
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
  const runGain = new RunGainAccumulator();

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

  // Items the provider returned, before the day window / cap (what the run actually fetched and cost).
  const postsFetched = data.posts.length;
  let postsOutsideWindow = 0;

  try {
    // 1b. Daily discovery only counts posts made today (IST). The window is also enforced here
    // because not every actor honours its date input (e.g. X). Refresh runs target older posts
    // on purpose, so they are never windowed.
    if ((options.jobType ?? "discovery") === "discovery" && options.enforceDayWindow !== false) {
      const { kept, dropped } = applyDayWindowAndCap(
        data.posts,
        options.postCapPerAccount ?? null,
        options.dayWindowAnchor ?? new Date()
      );
      postsOutsideWindow = dropped;
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

    // Fetch existing review queue items to preserve human review decisions. Paged: the queue
    // passes Supabase's 1000-row cap during the campaign, and a missing row would let a
    // rejected post be queued again.
    const existingReviewsRaw = await fetchAllRows<{ platform: string; platform_post_id: string; status: string }>(
      (from, to) =>
        supabase
          .from("review_queue")
          .select("platform, platform_post_id, status")
          .order("id")
          .range(from, to)
    ).catch((err: unknown) => {
      throw new Error(`Failed to query review queue: ${err instanceof Error ? err.message : String(err)}`);
    });

    const existingReviewStatusMap = new Map<string, string>();
    for (const r of existingReviewsRaw) {
      existingReviewStatusMap.set(`${r.platform}:${r.platform_post_id}`, r.status);
    }

    // 3. Fetch all active monitored accounts across platforms (about 1800 at full scale, so paged;
    // an account missing here would have all its posts skipped)
    const allMonitoredAccounts = await fetchAllRows<{
      id: string;
      handle: string;
      platform: string;
      is_visible: boolean;
    }>((from, to) =>
      supabase
        .from("accounts")
        .select("id, handle, platform, is_visible")
        .eq("status", "active")
        .order("id")
        .range(from, to)
    ).catch((err: unknown) => {
      throw new Error(`Failed to query accounts: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Always platform-qualified: the same handle can belong to different volunteers on different
    // platforms, and a bare-handle fallback would attach an X post to an Instagram account.
    const accountIdMap = new Map<string, string>();
    for (const acc of allMonitoredAccounts) {
      accountIdMap.set(`${acc.platform}:${acc.handle.toLowerCase()}`, acc.id);
    }

    // 4. Update account visibility and last_checked_at
    const checkedNow = new Date().toISOString();
    const returnedPlatformHandles = new Set(
      Array.from(data.accounts.entries()).map(([h, m]) => `${m.platform}:${h.toLowerCase()}`)
    );
    const visibleAccountIds: string[] = [];
    const checkedOnlyAccountIds: string[] = [];

    const targetedSet = targetedHandlesFromRun
      ? new Set(targetedHandlesFromRun.map((h) => h.toLowerCase()))
      : null;

    for (const acc of allMonitoredAccounts) {
      const handleLower = acc.handle.toLowerCase();
      const platformHandle = `${acc.platform}:${handleLower}`;
      const isReturned = returnedPlatformHandles.has(platformHandle);

      if (isReturned) {
        visibleAccountIds.push(acc.id);
      } else if (
        targetedSet &&
        acc.platform === (options.platform ?? acc.platform) &&
        (targetedSet.has(handleLower) || targetedSet.has(platformHandle))
      ) {
        // Targeted but nothing came back. Discovery only fetches today's posts, so this usually
        // just means "did not post today" - not "private". Record the check, keep visibility as is.
        checkedOnlyAccountIds.push(acc.id);
      }
    }

    // Chunked: ~600 uuids in one `.in()` filter overflows the request URL.
    const updateAccounts = async (ids: string[], patch: Record<string, unknown>): Promise<void> => {
      for (const part of chunk(ids, 200)) {
        const { error: visErr } = await supabase.from("accounts").update(patch).in("id", part);
        if (visErr) errors.push(`Failed to update account visibility: ${visErr.message}`);
      }
    };
    await updateAccounts(visibleAccountIds, { is_visible: true, last_checked_at: checkedNow });
    await updateAccounts(checkedOnlyAccountIds, { last_checked_at: checkedNow });

    // 5. Upsert account snapshots, batched. Unmeasured (null) metrics are left out so a same-day
    // re-run never erases a value an earlier run measured; on a new row they are simply NULL.
    // Rows are grouped by which metrics they carry, because a batch upsert writes the union of
    // columns and would otherwise set a missing metric to NULL.
    const snapshotGroups = new Map<string, Record<string, unknown>[]>();
    for (const [handle, metrics] of Array.from(data.accounts.entries())) {
      const accountId = accountIdMap.get(`${metrics.platform}:${handle.toLowerCase()}`);
      if (!accountId) continue;
      const measured = measuredOnly({
        followers: metrics.followers,
        following: metrics.following,
        post_count: metrics.post_count,
      });
      const groupKey = Object.keys(measured).sort().join(",");
      const list = snapshotGroups.get(groupKey) ?? [];
      list.push({ account_id: accountId, snapshot_date: targetDate, ...measured });
      snapshotGroups.set(groupKey, list);
    }
    for (const rows of Array.from(snapshotGroups.values())) {
      for (const part of chunk(rows, 500)) {
        const { error: accSnapshotError } = await supabase
          .from("account_snapshots")
          .upsert(part, { onConflict: "account_id,snapshot_date" });
        if (accSnapshotError) {
          errors.push(`Failed to upsert ${part.length} account snapshot(s): ${accSnapshotError.message}`);
        }
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

        // The latest snapshot stored BEFORE this write (today's own, if an earlier run already
        // saved one, otherwise the most recent earlier day). Used only for the run's gain summary.
        const { data: prevSnap } = await supabase
          .from("post_snapshots")
          .select("likes, comments, views")
          .eq("post_id", legacyPost.id)
          .lte("snapshot_date", targetDate)
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { error: snapErr } = await supabase.from("post_snapshots").upsert(
          {
            post_id: legacyPost.id,
            snapshot_date: targetDate,
            // Null = not measured this time: omitted so it cannot overwrite today's earlier value.
            ...measuredOnly({
              likes: post.metrics.likes,
              comments: post.metrics.comments,
              shares: post.metrics.shares,
              views: post.metrics.views,
              quotes: post.metrics.quotes ?? null,
            }),
            // The full vendor payload is kept once (first snapshot of the post) for debugging;
            // storing it every day for every post would grow by tens of GB over a campaign.
            ...(prevSnap ? {} : { raw_json: post.raw_json }),
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
        runGain.record(
          { url: post.url, handle: post.account_handle, platform: post.platform },
          prevSnap
            ? { likes: prevSnap.likes ?? null, comments: prevSnap.comments ?? null, views: prevSnap.views ?? null }
            : null,
          { likes: post.metrics.likes, comments: post.metrics.comments, views: post.metrics.views }
        );
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
    const unknownHandles = new Set<string>();
    const processPost = async (post: AdapterResult["posts"][number]): Promise<void> => {
      const handleLower = post.account_handle.toLowerCase();
      const accountId = accountIdMap.get(`${post.platform}:${handleLower}`);
      if (!accountId) {
        // Not a monitored account (tagged user, related profile, unresolvable handle). Counted so
        // the run log shows it instead of the post vanishing without a trace.
        postsDiscarded++;
        unknownHandles.add(`${post.platform}:${handleLower}`);
        return;
      }

      const postKey = `${post.platform}:${post.platform_post_id}`;
      const existingStatus = existingReviewStatusMap.get(postKey);
      const route = routePost({
        captionMatchingEnabled,
        existingReviewStatus: existingStatus,
        // Two-tier matching with temporal embargo. Daily captions: a post only matches the caption
        // released on the same (IST) day.
        match: () =>
          matchCaption(post.caption, activeCaptions, approvedVariants, {
            postedAt: post.posted_at,
            sameDayOnly: true,
          }),
      });

      const keep = async (label?: { matchStatus: PostMatchStatus; captionId: string | null }): Promise<void> => {
        if (await mirrorToPosts(post, accountId, label)) {
          postsMatched++;
          snapshotsCreated++;
        }
      };

      if (route.action === "store_unlabelled") {
        // Caption filter OFF: no matching; the post keeps its existing label.
        await keep();
        return;
      }

      if (route.action === "label") {
        // rejected (admin decision, never re-queued) / unmatched / matched via earlier approval
        await keep({ matchStatus: route.matchStatus, captionId: route.captionId });
        return;
      }

      if (route.action === "queue_review") {
        const { error: queueError } = await supabase
          .from("review_queue")
          .upsert(
            {
              caption_id: route.captionId,
              account_id: accountId,
              platform: post.platform,
              platform_post_id: post.platform_post_id,
              post_url: post.url,
              candidate_caption: post.caption ?? "",
              similarity_score: route.confidence,
              // `status` is deliberately omitted: a new row gets the column default
              // ('pending') and an existing row keeps the admin's decision, even one made
              // while this run was in progress.
            },
            {
              onConflict: "platform,platform_post_id",
            }
          );

        if (queueError) {
          errors.push(`Failed to queue post ${post.platform_post_id} for review: ${queueError.message}`);
        } else {
          reviewsQueued++;
          if (!existingStatus) existingReviewStatusMap.set(postKey, "pending");
        }
        // Keep the post and its engagement while it waits for review
        await keep({ matchStatus: "needs_review", captionId: route.captionId });
        return;
      }

      const matchResult = route.match;

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

      // Growth is null (not 0) when either side was not measured.
      const deltaLikes = growthOrNull(post.metrics.likes, prevLikes);
      const deltaComments = growthOrNull(post.metrics.comments, prevComments);
      const deltaViews = growthOrNull(post.metrics.views, prevViews);
      const deltaShares = growthOrNull(post.metrics.shares, prevShares);

      // Upsert daily point-in-time metric snapshot
      const snapshotSource = options.jobType === "refresh" ? "weekly_refresh" : "daily_batch";
      const { error: snapshotError } = await supabase
        .from("metric_snapshots")
        .upsert(
          {
            post_id: matchedPost.id,
            snapshot_date: targetDate,
            ...measuredOnly({
              likes: post.metrics.likes,
              comments: post.metrics.comments,
              views: post.metrics.views,
              shares: post.metrics.shares ?? null,
            }),
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

    if (unknownHandles.size > 0) {
      console.warn(
        `[ingestion] Skipped ${postsDiscarded} post(s) from ${unknownHandles.size} handle(s) that are not monitored accounts: ${Array.from(unknownHandles).slice(0, 20).join(", ")}`
      );
    }

    // 7. Finalize collection_runs audit record
    const finalStatus: RunStatus = errors.length === 0 ? "success" : "partial";
    const { error: finalizeError } = await supabase
      .from("collection_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: finalStatus,
        provider: options.provider || "apify",
        job_type: options.jobType || "discovery",
        posts_found: postsFetched,
        posts_upserted: postsMatched,
        posts_new: options.jobType === "refresh" ? 0 : postsMatched,
        posts_refreshed: options.jobType === "refresh" ? postsMatched : 0,
        snapshots_created: snapshotsCreated,
        // Keep the targeted handles so a retry of a partial run can still update visibility.
        error:
          errors.length > 0
            ? { messages: errors, ...(targetedHandlesFromRun ? { targeted_handles: targetedHandlesFromRun } : {}) }
            : null,
        posts_skipped_unknown: postsDiscarded,
        posts_outside_day_window: postsOutsideWindow,
      })
      .eq("id", runId);
    if (finalizeError) {
      // The data is saved; only the audit row is stale. Surface it rather than hide it.
      console.error(`[collection_runs] Failed to finalize run ${runId}:`, finalizeError.message);
    }

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
      gain: runGain.result(),
      errors,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errors.push(errorMsg);

    const { error: failLogError } = await supabase
      .from("collection_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        posts_upserted: postsMatched,
        snapshots_created: snapshotsCreated,
        error: {
          fatal: errorMsg,
          messages: errors,
          ...(targetedHandlesFromRun ? { targeted_handles: targetedHandlesFromRun } : {}),
        },
      })
      .eq("id", runId);
    if (failLogError) {
      console.error(`[collection_runs] Failed to record failure for run ${runId}:`, failLogError.message);
    }

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
