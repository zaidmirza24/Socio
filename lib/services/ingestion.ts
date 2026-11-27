import { createAdminClient, type AdminClient } from "../supabase/admin.ts";
import { formatDate } from "../utils.ts";
import { applyDayWindowAndCap } from "../utils/day-window.ts";
import { fetchAllRows, chunk } from "../supabase/paginate.ts";
import { growthOrNull, measuredOnly } from "../metrics/integrity.ts";
import { getFeatureSettings } from "./settings.ts";
import { RunGainAccumulator, type RunGain } from "../metrics/run-gain.ts";
import type { AdapterResult } from "../collectors/instagram.ts";
import type { PlatformType, RunStatus, ScraperJobType, PostMatchStatus } from "../../types/database.ts";
import { routePost, type FinalMatch } from "./post-routing.ts";
import {
  matchCaption,
  type MatchableCaption,
  type MatchableVariant,
  type MatchDiagnostics,
} from "../matching/matcher.ts";

/** Caption-match label written to `posts` (status, caption, and why the matcher decided so). */
interface PostLabel {
  matchStatus: PostMatchStatus;
  captionId: string | null;
  diagnostics?: MatchDiagnostics;
}

/** posts.match_* audit columns for a matcher decision (empty when matching did not run). */
export function matchDiagnosticsColumns(
  d: MatchDiagnostics | undefined
): { match_score: number | null; match_best_caption_id: string | null; match_reason: string } | Record<string, never> {
  if (!d) return {};
  return { match_score: d.score, match_best_caption_id: d.bestCaptionId, match_reason: d.reason };
}

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
  /** Database client to use. Defaults to the service-role client; tests pass a local database. */
  db?: AdminClient;
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
  const supabase = options.db ?? createAdminClient();
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
        console.warn(`[ingestion] Day window dropped ${dropped} of ${data.posts.length} posts not made today (IST).`);
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

    // Feature flag: when Campaign Captions is OFF, skip matching and keep every post.
    // When ON, every post is STILL kept (with its engagement history); matching only labels it
    // matched / needs review / not matched.
    const { campaign_captions_enabled: captionMatchingEnabled } = await getFeatureSettings(supabase);

    // 6. Decide what happens to each post (in memory), then write every table in bulk.
    // Writes are grouped and chunked (writeRows), so a run costs a handful of round-trips per
    // 500 posts instead of 3-6 per post. Every write is still an idempotent upsert.
    type Post = AdapterResult["posts"][number];
    interface Planned {
      post: Post;
      accountId: string;
      /** Label to write on `posts`; undefined leaves the stored label untouched. */
      label?: PostLabel;
      review?: { captionId: string; confidence: number };
      track?: { captionId: string; normalizedCaption: string; tier: FinalMatch["tier"]; confidence: number };
      /** Whether keeping this post counts toward postsMatched/snapshotsCreated (tracked posts are counted via matched_posts). */
      counts: boolean;
    }

    // The same post twice in one dataset would make a bulk upsert touch one row twice (an error),
    // so keep only its last occurrence (what sequential processing ended up storing).
    const uniquePosts = new Map<string, Post>();
    for (const post of data.posts) uniquePosts.set(`${post.platform}:${post.platform_post_id}`, post);

    const unknownHandles = new Set<string>();
    const planned: Planned[] = [];
    for (const post of Array.from(uniquePosts.values())) {
      const handleLower = post.account_handle.toLowerCase();
      const accountId = accountIdMap.get(`${post.platform}:${handleLower}`);
      if (!accountId) {
        // Not a monitored account (tagged user, related profile, unresolvable handle). Counted so
        // the run log shows it instead of the post vanishing without a trace.
        postsDiscarded++;
        unknownHandles.add(`${post.platform}:${handleLower}`);
        continue;
      }
      try {
        const route = routePost({
          captionMatchingEnabled,
          existingReviewStatus: existingReviewStatusMap.get(`${post.platform}:${post.platform_post_id}`),
          // Two-tier matching with temporal embargo. Daily captions: a post only matches the caption
          // released on the same (IST) day.
          match: () =>
            matchCaption(post.caption, activeCaptions, approvedVariants, {
              postedAt: post.posted_at,
              sameDayOnly: true,
            }),
        });
        if (route.action === "store_unlabelled") {
          // Caption filter OFF: no matching; the post keeps its existing label.
          planned.push({ post, accountId, counts: true });
        } else if (route.action === "label") {
          // rejected (admin decision, never re-queued) / unmatched / matched via earlier approval
          planned.push({
            post,
            accountId,
            counts: true,
            label: { matchStatus: route.matchStatus, captionId: route.captionId, diagnostics: route.diagnostics },
          });
        } else if (route.action === "queue_review") {
          // Keep the post and its engagement while it waits for review
          planned.push({
            post,
            accountId,
            counts: true,
            review: { captionId: route.captionId, confidence: route.confidence },
            label: { matchStatus: "needs_review", captionId: route.captionId, diagnostics: route.diagnostics },
          });
        } else {
          // Tier 1 exact match or approved variant -> matched_posts + metric_snapshots
          planned.push({
            post,
            accountId,
            counts: false,
            track: {
              captionId: route.match.captionId,
              normalizedCaption: route.match.normalizedCaption,
              tier: route.match.tier,
              confidence: route.match.confidence,
            },
            label: { matchStatus: "matched", captionId: route.match.captionId, diagnostics: route.diagnostics },
          });
        }
      } catch (postErr: unknown) {
        errors.push(
          `Failed to process post ${post.platform_post_id}: ${postErr instanceof Error ? postErr.message : String(postErr)}`
        );
      }
    }

    const nowIso = new Date().toISOString();

    // 6a. Review queue. `status` is deliberately omitted: a new row gets the column default
    // ('pending') and an existing row keeps the admin's decision, even one made mid-run.
    const toReview = planned.filter((p) => p.review);
    const reviewResults = await writeRows(
      supabase,
      "review_queue",
      toReview.map((p) => ({
        caption_id: p.review!.captionId,
        account_id: p.accountId,
        platform: p.post.platform,
        platform_post_id: p.post.platform_post_id,
        post_url: p.post.url,
        candidate_caption: p.post.caption ?? "",
        similarity_score: p.review!.confidence,
      })),
      "platform,platform_post_id",
      null
    );
    reviewResults.forEach((r, i) => {
      if (r.ok) reviewsQueued++;
      else errors.push(`Failed to queue post ${toReview[i].post.platform_post_id} for review: ${r.error}`);
    });

    // 6b. matched_posts for tracked posts.
    const toTrack = planned.filter((p) => p.track);
    const trackResults = await writeRows(
      supabase,
      "matched_posts",
      toTrack.map((p) => ({
        caption_id: p.track!.captionId,
        account_id: p.accountId,
        platform: p.post.platform,
        platform_post_id: p.post.platform_post_id,
        post_url: p.post.url,
        normalized_caption: p.track!.normalizedCaption,
        match_tier: p.track!.tier,
        match_confidence: p.track!.confidence,
        tracking_status: "tracking",
        posted_at: p.post.posted_at,
        last_seen_at: nowIso,
        last_metrics_refresh_at: nowIso,
        thumbnail_url: p.post.thumbnail_url ?? null,
      })),
      "platform,platform_post_id",
      "id"
    );
    const tracked: Array<{ plan: Planned; matchedPostId: string }> = [];
    trackResults.forEach((r, i) => {
      const plan = toTrack[i];
      const id = r.ok ? (r.row?.id as string | undefined) : undefined;
      if (id) {
        postsMatched++;
        tracked.push({ plan, matchedPostId: id });
        return;
      }
      errors.push(`Failed to upsert matched_post ${plan.post.platform_post_id}: ${r.ok ? "no row returned" : r.error}`);
      // Still store the post and today's snapshot (nothing is discarded). The label is left as
      // is: there is no matched_posts row to back a 'matched' label. The run ends 'partial', and
      // re-ingesting it labels the post properly once the matched_posts write succeeds.
      plan.label = undefined;
      plan.track = undefined;
      plan.counts = true;
    });

    // 6c. metric_snapshots for tracked posts, with deltas against the previous day's values.
    // Growth is null (not 0) when either side was not measured.
    const prevMetrics = await latestSnapshotBefore<{ likes: number | null; comments: number | null; views: number | null; shares: number | null }>(
      supabase,
      "metric_snapshots",
      "likes, comments, views, shares",
      tracked.map((t) => t.matchedPostId),
      targetDate,
      false,
      (msg) => errors.push(msg)
    );
    const snapshotSource = options.jobType === "refresh" ? "weekly_refresh" : "daily_batch";
    const metricResults = await writeRows(
      supabase,
      "metric_snapshots",
      tracked.map(({ plan, matchedPostId }) => {
        const m = plan.post.metrics;
        const prev = prevMetrics.get(matchedPostId);
        return {
          post_id: matchedPostId,
          snapshot_date: targetDate,
          ...measuredOnly({ likes: m.likes, comments: m.comments, views: m.views, shares: m.shares ?? null }),
          delta_likes: growthOrNull(m.likes, prev?.likes ?? null),
          delta_comments: growthOrNull(m.comments, prev?.comments ?? null),
          delta_views: growthOrNull(m.views, prev?.views ?? null),
          delta_shares: growthOrNull(m.shares, prev?.shares ?? null),
          source: snapshotSource,
          fetched_at: nowIso,
        };
      }),
      "post_id,snapshot_date",
      null
    );
    metricResults.forEach((r, i) => {
      if (r.ok) snapshotsCreated++;
      else errors.push(`Failed to record metric snapshot for post ${tracked[i].plan.post.platform_post_id}: ${r.error}`);
    });

    // 6d. Every post (all routes) into `posts`. `label` absent = existing label untouched (a new
    // post starts as 'unmatched' via the column default).
    const postResults = await writeRows(
      supabase,
      "posts",
      planned.map(({ post, accountId, label }) => ({
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
          ? { match_status: label.matchStatus, matched_caption_id: label.captionId, ...matchDiagnosticsColumns(label.diagnostics) }
          : {}),
      })),
      "platform,platform_post_id",
      "id"
    );
    const stored: Array<{ plan: Planned; postId: string }> = [];
    postResults.forEach((r, i) => {
      const id = r.ok ? (r.row?.id as string | undefined) : undefined;
      if (id) stored.push({ plan: planned[i], postId: id });
      else
        errors.push(
          `Failed to save post ${planned[i].post.platform_post_id} for the dashboard: ${r.ok ? "no row returned" : r.error}`
        );
    });

    // 6e. Today's snapshot per post. The latest snapshot stored BEFORE this write (today's own if
    // an earlier run saved one, else the most recent earlier day) feeds the run's gain summary.
    const prevSnaps = await latestSnapshotBefore<{ likes: number | null; comments: number | null; views: number | null }>(
      supabase,
      "post_snapshots",
      "likes, comments, views",
      stored.map((s) => s.postId),
      targetDate,
      true,
      (msg) => errors.push(msg)
    );
    const snapResults = await writeRows(
      supabase,
      "post_snapshots",
      stored.map(({ plan, postId }) => ({
        post_id: postId,
        snapshot_date: targetDate,
        // Null = not measured this time: omitted so it cannot overwrite today's earlier value.
        ...measuredOnly({
          likes: plan.post.metrics.likes,
          comments: plan.post.metrics.comments,
          shares: plan.post.metrics.shares,
          views: plan.post.metrics.views,
          quotes: plan.post.metrics.quotes ?? null,
        }),
        // The full vendor payload is kept once (first snapshot of the post) for debugging;
        // storing it every day for every post would grow by tens of GB over a campaign.
        ...(prevSnaps.has(postId) ? {} : { raw_json: plan.post.raw_json }),
      })),
      "post_id,snapshot_date",
      null
    );
    snapResults.forEach((r, i) => {
      const { plan, postId } = stored[i];
      if (!r.ok) {
        errors.push(`Failed to save snapshot for post ${plan.post.platform_post_id}: ${r.error}`);
        return;
      }
      if (plan.counts) {
        postsMatched++;
        snapshotsCreated++;
      }
      const prev = prevSnaps.get(postId);
      runGain.record(
        { url: plan.post.url, handle: plan.post.account_handle, platform: plan.post.platform },
        prev ? { likes: prev.likes ?? null, comments: prev.comments ?? null, views: prev.views ?? null } : null,
        { likes: plan.post.metrics.likes, comments: plan.post.metrics.comments, views: plan.post.metrics.views }
      );
    });

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

// ─────────────────────────────────────────────────────────────
// Bulk write helpers
// ─────────────────────────────────────────────────────────────

type DbRow = Record<string, unknown>;
export type WriteResult = { ok: true; row: DbRow | null } | { ok: false; error: string };

/** Rows per bulk upsert. Keeps request bodies and statement sizes modest. */
const WRITE_CHUNK = 500;
/** Post ids per `.in()` lookup (each uuid adds ~37 characters to the request URL). */
const LOOKUP_CHUNK = 100;

/**
 * Idempotent bulk upsert with per-row results, in input order.
 *
 * - Rows are grouped by their exact set of columns: a bulk upsert writes the union of columns and
 *   would set a column missing from one row to NULL (e.g. erase a measured metric or a label).
 * - Each group is written in chunks; a chunk that fails is retried row by row, so one bad row
 *   cannot fail its neighbours and every failure is reported against its own row.
 * - With `returning`, each result carries its returned row (matched back by the conflict key).
 * The caller must not pass two rows with the same conflict key (Postgres rejects that).
 */
export async function writeRows(
  supabase: AdminClient,
  table: string,
  rows: DbRow[],
  onConflict: string,
  returning: string | null
): Promise<WriteResult[]> {
  const results: WriteResult[] = new Array(rows.length);
  if (rows.length === 0) return results;

  const keyCols = onConflict.split(",").map((c) => c.trim());
  const keyOf = (r: DbRow) => keyCols.map((c) => String(r[c])).join("\u0000");
  const selectCols = returning
    ? Array.from(new Set([...returning.split(",").map((c) => c.trim()), ...keyCols])).join(", ")
    : null;

  const upsert = async (batch: DbRow[]): Promise<{ data: DbRow[] | null; error: string | null }> => {
    const q = supabase.from(table).upsert(batch, { onConflict });
    const { data, error } = selectCols ? await q.select(selectCols) : await q;
    return { data: (data as DbRow[] | null) ?? null, error: error ? error.message : null };
  };

  const record = (indexes: number[], data: DbRow[] | null) => {
    const byKey = new Map((data ?? []).map((r) => [keyOf(r), r]));
    for (const i of indexes) results[i] = { ok: true, row: selectCols ? byKey.get(keyOf(rows[i])) ?? null : null };
  };

  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const signature = Object.keys(r).sort().join(",");
    const list = groups.get(signature) ?? [];
    list.push(i);
    groups.set(signature, list);
  });

  for (const indexes of Array.from(groups.values())) {
    for (const part of chunk(indexes, WRITE_CHUNK)) {
      const res = await upsert(part.map((i) => rows[i]));
      if (!res.error) {
        record(part, res.data);
        continue;
      }
      for (const i of part) {
        const single = await upsert([rows[i]]);
        if (single.error) results[i] = { ok: false, error: single.error };
        else record([i], single.data);
      }
    }
  }
  return results;
}

/**
 * For each post id, its most recent snapshot row on/before (`inclusive`) or strictly before
 * `targetDate`. A failed lookup is reported through `onError` and treated as "no earlier
 * snapshot" (the run still stores everything; only the gain summary / deltas lose a baseline).
 */
export async function latestSnapshotBefore<T extends DbRow>(
  supabase: AdminClient,
  table: "post_snapshots" | "metric_snapshots",
  columns: string,
  postIds: string[],
  targetDate: string,
  inclusive: boolean,
  onError: (message: string) => void
): Promise<Map<string, T>> {
  const latest = new Map<string, T>();
  for (const part of chunk(Array.from(new Set(postIds)), LOOKUP_CHUNK)) {
    try {
      const rows = await fetchAllRows<T & { post_id: string }>((from, to) => {
        const q = supabase.from(table).select(`post_id, snapshot_date, ${columns}`).in("post_id", part);
        // The column list is built at runtime, so the client cannot type the rows; T describes them.
        return (inclusive ? q.lte("snapshot_date", targetDate) : q.lt("snapshot_date", targetDate))
          .order("post_id", { ascending: true })
          .order("snapshot_date", { ascending: false })
          .range(from, to) as unknown as PromiseLike<{
          data: Array<T & { post_id: string }> | null;
          error: { message: string } | null;
        }>;
      });
      for (const r of rows) if (!latest.has(r.post_id)) latest.set(r.post_id, r);
    } catch (err: unknown) {
      onError(`Could not read earlier ${table} for ${part.length} post(s): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return latest;
}
