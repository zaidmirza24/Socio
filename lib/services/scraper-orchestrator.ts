import { randomUUID } from "node:crypto";
import { createAdminClient } from "../supabase/admin.ts";
import { getScraperProvider } from "../scrapers/factory.ts";
import { getScraperRefreshStrategy, getPlatformSettings } from "./settings.ts";
import { recordRunUsage } from "./apify-usage.ts";
import { processIngestion, type IngestionSummary } from "./ingestion.ts";
import { getScrapeBoundaryDate } from "../utils/day-window.ts";
import { fetchAllRows } from "../supabase/paginate.ts";
import { DIRECT_URL_BATCH_SIZE, MAX_CONCURRENT_REFRESH_RUNS } from "../config/batching.ts";
import { formatDate } from "../utils.ts";
import type { PlatformType } from "../../types/database.ts";
import type {
  ScraperDiscoveryOptions,
  ScraperRefreshOptions,
  ScraperJobTriggerResult,
  ScraperJobStatusResult,
  DirectPostDetails,
  ScraperProviderType,
} from "../scrapers/types.ts";

export const DEFAULT_DIRECT_URL_BATCH_SIZE = DIRECT_URL_BATCH_SIZE;

/** True when the provider rejected a start because the account's memory limit is used up. */
export function isMemoryLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /memory limit/i.test(msg);
}

export const MEMORY_FULL_MESSAGE =
  "Apify's memory limit is full because other runs are still going. Wait for them to finish (or abort them in the Apify Console), then try again.";

/** A run still marked started/ingesting after this long is treated as abandoned. */
const ACTIVE_RUN_WINDOW_MS = 6 * 60 * 60 * 1000;
/** An ingestion claim older than this is assumed dead (crashed request) and can be re-claimed. */
const INGEST_CLAIM_TTL_MS = 15 * 60 * 1000;

/**
 * Thrown when a run of the same platform + job type is already in progress. Carries the Apify
 * run ids so callers can resume polling them instead of paying for a second identical run.
 */
export class RunAlreadyActiveError extends Error {
  readonly runIds: string[];
  /** Refresh only: the queued job to follow (batches may still be waiting to start). */
  readonly batchGroup: string | null;
  constructor(
    platform: PlatformType,
    jobType: "discovery" | "refresh",
    runIds: string[],
    batchGroup: string | null = null
  ) {
    super(
      `A ${jobType === "refresh" ? "refresh" : "discovery"} run for ${platform} is already in progress. Following it instead of starting another.`
    );
    this.name = "RunAlreadyActiveError";
    this.runIds = runIds;
    this.batchGroup = batchGroup;
  }
}

/** The refresh job of this platform that still has batches waiting to start, if any (recent only). */
async function findPendingRefreshGroup(platform: PlatformType): Promise<string | null> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - ACTIVE_RUN_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("refresh_queue")
    .select("batch_group")
    .eq("platform", platform)
    .in("status", ["queued", "starting"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not check the refresh queue: ${error.message}`);
  return (data?.batch_group as string | undefined) ?? null;
}

/** Apify run ids of recent runs for this platform + job type that have not finished saving. */
export async function findActiveRunIds(
  platform: PlatformType,
  jobType: "discovery" | "refresh"
): Promise<string[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - ACTIVE_RUN_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("collection_runs")
    .select("actor_run_id")
    .eq("platform", platform)
    .eq("job_type", jobType)
    .in("status", ["started", "ingesting"])
    .gte("started_at", since)
    .not("actor_run_id", "is", null);
  if (error) {
    throw new Error(`Could not check for runs already in progress: ${error.message}`);
  }
  return (data ?? []).map((r) => r.actor_run_id as string);
}

async function assertNoActiveRun(platform: PlatformType, jobType: "discovery" | "refresh"): Promise<void> {
  const active = await findActiveRunIds(platform, jobType);
  const group = jobType === "refresh" ? await findPendingRefreshGroup(platform) : null;
  if (active.length > 0 || group) throw new RunAlreadyActiveError(platform, jobType, active, group);
}

/** Inserts the audit row for a started provider run. Throws if it cannot be written. */
async function logRunStart(row: {
  actor_run_id: string;
  platform: PlatformType;
  provider: string;
  job_type: "discovery" | "refresh";
  accounts_targeted: number;
  posts_found: number;
  error: Record<string, unknown>;
}): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("collection_runs").insert({
    ...row,
    started_at: new Date().toISOString(),
    status: "started",
    posts_upserted: 0,
    snapshots_created: 0,
  });
  if (error) {
    // Without this row the run cannot be ingested safely (platform and job type are unknown).
    throw new Error(
      `Run ${row.actor_run_id} started on ${row.provider} but could not be logged: ${error.message}. Abort it in the provider console to avoid paying for it.`
    );
  }
}

/**
 * Enforces the Settings → platform toggles at runtime (stored in system_settings).
 * Instagram is the baseline platform and is always allowed.
 */
export async function assertPlatformEnabled(platform: PlatformType): Promise<void> {
  if (platform === "instagram") return;
  const settings = await getPlatformSettings();
  if (!settings[platform]?.enabled) {
    throw new Error(
      `Platform '${platform}' is disabled. Enable it in Settings → Multi-Platform Monitoring before running it.`
    );
  }
}

/**
 * Helper to fetch the earliest release date among all active campaign captions.
 * Used to populate `onlyPostsNewerThan` so discovery scrapers ignore older historical posts.
 */
export async function getEarliestActiveCaptionDate(): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("campaign_captions")
      .select("released_at")
      .eq("status", "active")
      .order("released_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data?.released_at) {
      return null;
    }

    // Captions only match posts from the same day, so a 1-day buffer (timezone safety) is enough.
    // A wider window just makes the scraper fetch (and us pay for) posts that can never match.
    const date = new Date(data.released_at);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

/**
 * PART A: Triggers Daily New-Post Discovery across active monitored accounts.
 * Limits crawling depth to top-N recent posts (default 10) and only posts newer than campaign embargo.
 */
export async function triggerDailyDiscovery(
  options: ScraperDiscoveryOptions = {},
  providerOverride?: ScraperProviderType
): Promise<ScraperJobTriggerResult> {
  const platform: PlatformType = options.platform || "instagram";
  await assertPlatformEnabled(platform);
  const provider = getScraperProvider(providerOverride);
  const strategy = await getScraperRefreshStrategy();

  // 1. Preflight validation
  const preflight = await provider.validateConfiguration();
  if (!preflight.valid) {
    throw new Error(`Scraper pre-flight failed (${provider.name}):\n• ` + preflight.errors.join("\n• "));
  }

  const supabase = createAdminClient();

  // 1b. Never pay for two identical runs (double-click, two tabs, two admins)
  await assertNoActiveRun(platform, "discovery");

  // 2. Resolve target handles
  let targetHandles: string[];
  if (options.customHandles && options.customHandles.length > 0) {
    targetHandles = options.customHandles.map((h) => h.replace(/^@/, "").trim().toLowerCase());
  } else {
    let accounts: { handle: string }[];
    try {
      accounts = await fetchAllRows<{ handle: string }>((from, to) =>
        supabase
          .from("accounts")
          .select("handle")
          .eq("platform", platform)
          .eq("status", "active")
          .order("id")
          .range(from, to)
      );
    } catch (accError: unknown) {
      throw new Error(
        `Database error querying active accounts: ${accError instanceof Error ? accError.message : String(accError)}`
      );
    }

    if (accounts.length === 0) {
      throw new Error(`No active ${platform} accounts found. Add accounts in the Accounts tab first.`);
    }

    targetHandles = accounts.map((a) => a.handle.replace(/^@/, "").trim().toLowerCase());
  }

  // 3. Resolve post limit and newerThan boundary
  const postLimit = options.postLimit || strategy.discovery_post_limit || 10;
  // Daily discovery covers today's posts only (IST). The boundary is the day before so posts
  // made 00:00-05:30 IST are not cut off by actors that read a bare date as UTC; ingestion then
  // applies the exact IST-day cut.
  const newerThan = options.onlyPostsNewerThan || getScrapeBoundaryDate();

  // 4. Dispatch discovery job via provider
  const triggerResult = await provider.startDiscoveryJob(targetHandles, {
    ...options,
    platform,
    postLimit,
    onlyPostsNewerThan: newerThan ?? undefined,
  });

  // 5. Audit log in collection_runs (required: ingestion reads platform/job type from it)
  await logRunStart({
    actor_run_id: triggerResult.jobId,
    platform,
    provider: provider.name,
    job_type: "discovery",
    accounts_targeted: targetHandles.length,
    posts_found: 0,
    error: { targeted_handles: targetHandles },
  });

  return triggerResult;
}

interface RefreshCandidate {
  url: string;
  last_metrics_refresh_at: string | null;
}

/**
 * Posts tracked for engagement refresh.
 * Caption-matched posts (matched_posts) plus every stored post in `posts`, which includes
 * unfiltered posts saved while Campaign Captions was OFF. These keep refreshing after the
 * feature is turned back ON. De-duplicated by URL since matched posts are mirrored in `posts`.
 */
async function getRefreshCandidates(
  platform: PlatformType,
  ageCutoff: string | null
): Promise<RefreshCandidate[]> {
  const supabase = createAdminClient();

  // Both tables grow past Supabase's 1000-row response cap within days, so page through them.
  let matchedRows: { post_url: string; last_metrics_refresh_at: string | null }[];
  try {
    matchedRows = await fetchAllRows<{ post_url: string; last_metrics_refresh_at: string | null }>(
      (from, to) => {
        let q = supabase
          .from("matched_posts")
          .select("post_url, last_metrics_refresh_at")
          .eq("platform", platform)
          .eq("tracking_status", "tracking");
        if (ageCutoff) q = q.gte("posted_at", ageCutoff);
        return q.order("id").range(from, to);
      }
    );
  } catch (err: unknown) {
    throw new Error(
      `Failed to query tracked posts for refresh: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const byUrl = new Map<string, RefreshCandidate>();

  // Also refresh every stored post, including unfiltered ones saved while Campaign Captions
  // was OFF. Posts whose match an admin rejected keep their history but are no longer refreshed.
  let allRows: { url: string; last_metrics_refresh_at: string | null }[];
  try {
    allRows = await fetchAllRows<{ url: string; last_metrics_refresh_at: string | null }>((from, to) => {
      let q = supabase
        .from("posts")
        .select("url, last_metrics_refresh_at")
        .eq("platform", platform)
        .neq("match_status", "rejected");
      if (ageCutoff) q = q.gte("posted_at", ageCutoff);
      return q.order("id").range(from, to);
    });
  } catch (err: unknown) {
    throw new Error(
      `Failed to query stored posts for refresh: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  for (const p of allRows) {
    byUrl.set(p.url, { url: p.url, last_metrics_refresh_at: p.last_metrics_refresh_at });
  }
  // matched_posts wins on conflict (its refresh timestamp is the authoritative one)
  for (const p of matchedRows) {
    byUrl.set(p.post_url, {
      url: p.post_url,
      last_metrics_refresh_at: p.last_metrics_refresh_at,
    });
  }
  return Array.from(byUrl.values());
}

export interface RefreshEligibilityStats {
  totalTrackedPosts: number;
  eligibleForRefresh: number;
  strategy: {
    mode: "30_day_cutoff" | "continuous";
    refresh_interval_days: number;
    cutoff_days: number;
  };
}

/**
 * Returns statistics about posts currently eligible for refresh under the active strategy.
 */
export async function getScraperRefreshEligibilityStats(
  platform: PlatformType = "instagram"
): Promise<RefreshEligibilityStats> {
  const supabase = createAdminClient();
  const strategy = await getScraperRefreshStrategy();
  const now = new Date();

  // Threshold date: posts refreshed before this date are eligible
  const refreshThreshold = new Date(
    now.getTime() - strategy.refresh_interval_days * 24 * 60 * 60 * 1000
  ).toISOString();

  // Age cutoff date if in 30-day cutoff mode
  const ageCutoff =
    strategy.mode === "30_day_cutoff"
      ? new Date(now.getTime() - strategy.cutoff_days * 24 * 60 * 60 * 1000).toISOString()
      : null;

  // Query all active tracked posts (matched + unfiltered)
  let posts: RefreshCandidate[] | null = null;
  try {
    posts = await getRefreshCandidates(platform, ageCutoff);
  } catch {
    posts = null;
  }

  if (!posts) {
    return {
      totalTrackedPosts: 0,
      eligibleForRefresh: 0,
      strategy: {
        mode: strategy.mode,
        refresh_interval_days: strategy.refresh_interval_days,
        cutoff_days: strategy.cutoff_days,
      },
    };
  }

  // Count posts whose last_metrics_refresh_at is null or older than refreshThreshold
  const eligible = posts.filter(
    (p) => !p.last_metrics_refresh_at || p.last_metrics_refresh_at <= refreshThreshold
  ).length;

  return {
    totalTrackedPosts: posts.length,
    eligibleForRefresh: eligible,
    strategy: {
      mode: strategy.mode,
      refresh_interval_days: strategy.refresh_interval_days,
      cutoff_days: strategy.cutoff_days,
    },
  };
}

/**
 * PART B: Triggers Seven-Day Existing-Post Engagement Refresh.
 * Evaluates the active strategy (30-day window cutoff vs. continuous tracking),
 * selects eligible post URLs whose refresh is due, and dispatches them in direct-URL batches.
 */
export async function triggerWeeklyRefresh(
  options: {
    platform?: PlatformType;
    maxBatchSize?: number;
    providerOverride?: ScraperProviderType;
    customUrls?: string[];
    /** Admin override: refresh every tracked post inside the age cutoff, even if not yet due. */
    force?: boolean;
  } = {}
): Promise<{
  success: boolean;
  /** Apify run ids of the batches started right away. */
  jobIds: string[];
  /** Follow this job with `getRefreshGroupProgress`; null when nothing was due. */
  batchGroup: string | null;
  /** Batches still waiting in the queue for a free slot / free Apify memory. */
  queuedCount: number;
  eligiblePostsCount: number;
  dispatchedBatchesCount: number;
  message: string;
}> {
  const platform: PlatformType = options.platform || "instagram";
  await assertPlatformEnabled(platform);
  const strategy = await getScraperRefreshStrategy();
  const now = new Date();

  // Batches still queued or running would be re-sent (and paid for) a second time.
  await assertNoActiveRun(platform, "refresh");

  // 1. Calculate eligibility thresholds
  const refreshThreshold = new Date(
    now.getTime() - strategy.refresh_interval_days * 24 * 60 * 60 * 1000
  ).toISOString();

  const ageCutoff =
    strategy.mode === "30_day_cutoff"
      ? new Date(now.getTime() - strategy.cutoff_days * 24 * 60 * 60 * 1000).toISOString()
      : null;

  // 2. Query eligible posts from matched_posts
  let targetUrls: string[] = [];

  if (options.customUrls && options.customUrls.length > 0) {
    targetUrls = options.customUrls;
  } else {
    const posts = await getRefreshCandidates(platform, ageCutoff);

    // Filter to posts whose last refresh was >= refresh_interval_days ago (or newly discovered / null).
    // `force` skips the interval check but still honours the age cutoff applied in getRefreshCandidates.
    const eligible = options.force
      ? posts
      : posts.filter(
          (p) => !p.last_metrics_refresh_at || p.last_metrics_refresh_at <= refreshThreshold
        );

    targetUrls = eligible.map((p) => p.url);
  }

  if (targetUrls.length === 0) {
    return {
      success: true,
      jobIds: [],
      batchGroup: null,
      queuedCount: 0,
      eligiblePostsCount: 0,
      dispatchedBatchesCount: 0,
      message: `No existing posts are currently due for their ${strategy.refresh_interval_days}-day engagement refresh (${strategy.mode === "30_day_cutoff" ? "30-day cutoff active" : "continuous mode active"}).`,
    };
  }

  // 3. Chunk URLs into batches (default 50 URLs per batch)
  const batchSize = options.maxBatchSize || DEFAULT_DIRECT_URL_BATCH_SIZE;
  const batches: string[][] = [];
  for (let i = 0; i < targetUrls.length; i += batchSize) {
    batches.push(targetUrls.slice(i, i + batchSize));
  }

  // 4. Put every batch in the database queue, then start as many as the concurrency limit allows.
  // Apify's memory limit is account-wide, so starting every batch at once gets them rejected; the
  // rest start as running batches finish (see advanceRefreshQueue), even if this tab is closed.
  const supabase = createAdminClient();
  const batchGroup = randomUUID();
  const { error: enqueueError } = await supabase.from("refresh_queue").insert(
    batches.map((urls, index) => ({ batch_group: batchGroup, platform, batch_index: index, urls }))
  );
  if (enqueueError) {
    throw new Error(`Could not queue the refresh batches: ${enqueueError.message}`);
  }

  const advance = await advanceRefreshQueue(options.providerOverride);
  const progress = await getRefreshGroupProgress(batchGroup);

  if (progress.runIds.length === 0 && advance.firstError) {
    // Nothing started and the failure is not "memory full" (e.g. out of credit, bad token):
    // report it now instead of retrying silently, and drop the batches we just queued.
    await cancelRefreshGroup(batchGroup);
    throw new Error(advance.firstError);
  }

  const what = options.force
    ? `force-refresh ${targetUrls.length} post(s)`
    : `refresh ${targetUrls.length} post(s) due for the ${strategy.refresh_interval_days}-day refresh`;
  return {
    success: true,
    jobIds: progress.runIds,
    batchGroup,
    queuedCount: progress.queued + progress.starting,
    eligiblePostsCount: targetUrls.length,
    dispatchedBatchesCount: progress.runIds.length,
    message:
      progress.queued > 0
        ? `Started ${progress.runIds.length} of ${batches.length} batch(es) to ${what}. ${progress.queued} more will start as these finish.`
        : `Dispatched ${batches.length} batch(es) to ${what}.`,
  };
}

/** Thrown when a run was started at the provider but its audit row could not be written. */
class RunLogError extends Error {
  readonly jobId: string;
  constructor(jobId: string, message: string) {
    super(message);
    this.name = "RunLogError";
    this.jobId = jobId;
  }
}

/** Starts one refresh batch at the provider and logs it. Used by the queue. */
async function startRefreshBatch(
  platform: PlatformType,
  urls: string[],
  providerOverride?: ScraperProviderType
): Promise<{ jobId: string }> {
  await assertPlatformEnabled(platform);
  const provider = getScraperProvider(providerOverride);
  const res = await provider.startRefreshJob(urls, { platform });
  try {
    await logRunStart({
      actor_run_id: res.jobId,
      platform,
      provider: provider.name,
      job_type: "refresh",
      accounts_targeted: 0,
      posts_found: urls.length,
      error: { target_urls: urls },
    });
  } catch (err: unknown) {
    // The run is already paid for, so it must not be started a second time.
    throw new RunLogError(res.jobId, err instanceof Error ? err.message : String(err));
  }
  return { jobId: res.jobId };
}

interface RefreshQueueRow {
  id: string;
  batch_group: string;
  platform: PlatformType;
  urls: string[];
  attempts: number;
}

/** A batch is given up on after this many failed start attempts (memory-full waits do not count). */
const MAX_QUEUE_START_ATTEMPTS = 3;

/**
 * Starts the next queued refresh batches, as many as the concurrency limit allows.
 *
 * Safe to call from anywhere and as often as you like: a webhook after a run is saved, a status
 * poll, the Collection Runs page. The database hands each batch to exactly one caller, so two
 * callers at once never start the same batch twice.
 */
export async function advanceRefreshQueue(
  providerOverride?: ScraperProviderType
): Promise<{ started: number; waitingForMemory: boolean; firstError: string | null }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_refresh_batches", {
    p_max_active: MAX_CONCURRENT_REFRESH_RUNS,
  });
  if (error) throw new Error(`Could not read the refresh queue: ${error.message}`);

  const rows = (data ?? []) as RefreshQueueRow[];
  let started = 0;
  let waitingForMemory = false;
  let firstError: string | null = null;
  const touch = async (id: string, patch: Record<string, unknown>) => {
    const { error: updateError } = await supabase
      .from("refresh_queue")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) console.error(`[refresh_queue] Could not update batch ${id}:`, updateError.message);
  };

  for (const row of rows) {
    if (waitingForMemory) {
      await touch(row.id, { status: "queued" }); // hand back the claim untouched
      continue;
    }
    try {
      const { jobId } = await startRefreshBatch(row.platform, row.urls, providerOverride);
      await touch(row.id, { status: "started", run_id: jobId });
      started++;
    } catch (err: unknown) {
      if (err instanceof RunLogError) {
        await touch(row.id, { status: "started", run_id: err.jobId, last_error: err.message });
        firstError ??= err.message;
      } else if (isMemoryLimitError(err)) {
        waitingForMemory = true;
        await touch(row.id, { status: "queued" });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        firstError ??= message;
        const attempts = row.attempts + 1;
        await touch(row.id, {
          status: attempts >= MAX_QUEUE_START_ATTEMPTS ? "failed" : "queued",
          attempts,
          last_error: message,
        });
      }
    }
  }
  return { started, waitingForMemory, firstError };
}

/**
 * `advanceRefreshQueue` for callers that are doing something else (saving a finished run): a
 * queue problem is logged, never allowed to fail the save. Call it once a run has ended, since
 * that frees a slot for the next batch.
 */
export async function advanceRefreshQueueQuietly(): Promise<void> {
  try {
    await advanceRefreshQueue();
  } catch (err: unknown) {
    console.error("[refresh_queue] Could not advance the queue:", err instanceof Error ? err.message : err);
  }
}

export interface RefreshGroupProgress {
  queued: number;
  /** Batches being handed to Apify right now. */
  starting: number;
  /** Apify run ids of every batch of this group that has been started. */
  runIds: string[];
  failed: number;
  cancelled: number;
  /** Error of the most recent failed batch, if any. */
  lastError: string | null;
}

/** Counts and run ids of one refresh job (all batches created by one "start refresh" click). */
export async function getRefreshGroupProgress(batchGroup: string): Promise<RefreshGroupProgress> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("refresh_queue")
    .select("status, run_id, last_error")
    .eq("batch_group", batchGroup);
  if (error) throw new Error(`Could not read the refresh queue: ${error.message}`);

  const progress: RefreshGroupProgress = {
    queued: 0,
    starting: 0,
    runIds: [],
    failed: 0,
    cancelled: 0,
    lastError: null,
  };
  for (const row of (data ?? []) as { status: string; run_id: string | null; last_error: string | null }[]) {
    if (row.status === "queued") progress.queued++;
    else if (row.status === "starting") progress.starting++;
    else if (row.status === "failed") progress.failed++;
    else if (row.status === "cancelled") progress.cancelled++;
    if (row.run_id) progress.runIds.push(row.run_id);
    if (row.status === "failed" && row.last_error) progress.lastError = row.last_error;
  }
  return progress;
}

/** Stops a refresh job from starting any more batches. Batches already running are unaffected. */
export async function cancelRefreshGroup(batchGroup: string): Promise<number> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("refresh_queue")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("batch_group", batchGroup)
    .in("status", ["queued", "starting"])
    .select("id");
  if (error) throw new Error(`Could not cancel the refresh job: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Fetches current engagement details for a single post URL via the active provider.
 * Used during review approvals and single-post inspections.
 */
export async function fetchSinglePostDetails(
  postUrl: string,
  platform: PlatformType = "instagram",
  providerOverride?: ScraperProviderType
): Promise<DirectPostDetails | null> {
  const provider = getScraperProvider(providerOverride);
  return provider.fetchDirectPost(postUrl, platform);
}

/**
 * Checks the live progress of a scraper job.
 */
export async function checkScraperJobStatus(
  jobId: string,
  providerOverride?: ScraperProviderType
): Promise<ScraperJobStatusResult> {
  const provider = getScraperProvider(providerOverride);
  return provider.checkJobStatus(jobId);
}

/** Canonical form of a post URL for comparing what was requested with what came back. */
export function canonicalPostUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "").replace(/^twitter\.com$/, "x.com");
    return `${host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
}

async function markUnreturnedRefreshTargets(requested: string[], returned: string[]): Promise<void> {
  const got = new Set(returned.map(canonicalPostUrl));
  const missing = requested.filter((u) => !got.has(canonicalPostUrl(u)));
  if (missing.length === 0) return;
  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();
  for (let i = 0; i < missing.length; i += 50) {
    const part = missing.slice(i, i + 50);
    const [a, b] = await Promise.all([
      supabase.from("posts").update({ last_metrics_refresh_at: nowIso }).in("url", part),
      supabase.from("matched_posts").update({ last_metrics_refresh_at: nowIso }).in("post_url", part),
    ]);
    if (a.error || b.error) {
      console.error("[refresh] Could not mark unreturned posts:", a.error?.message ?? b.error?.message);
    }
  }
  console.warn(`[refresh] ${missing.length} requested post(s) returned no data (deleted or private?).`);
}

export type IngestJobState =
  /** Provider is still queueing / crawling. */
  | "running"
  /** Another request is saving this run right now. */
  | "ingesting"
  /** Data is saved (by this request, or earlier when `summary` is absent). */
  | "succeeded"
  /** The provider run failed, or saving it failed. The run row is marked `failed`. */
  | "failed";

export interface IngestJobResult {
  state: IngestJobState;
  /** Present only for the request that actually saved the data. */
  summary?: IngestionSummary;
  message: string;
}

/**
 * Checks a provider run and, once it has finished, ingests its dataset exactly once.
 *
 * Several requests can poll the same run at the same time (the Run panel, the Health page's
 * "Ingest now"), so the run is claimed atomically (status -> 'ingesting') before any data is
 * fetched. Only the request that wins the claim ingests; the others report "ingesting".
 * Every terminal outcome is written to `collection_runs`, so a run never stays 'started'.
 */
export async function ingestCompletedJob(
  jobId: string,
  providerOverride?: ScraperProviderType
): Promise<IngestJobResult> {
  const provider = getScraperProvider(providerOverride);
  const supabase = createAdminClient();

  const { data: run, error: runError } = await supabase
    .from("collection_runs")
    .select("id, status, job_type, platform, started_at, error")
    .eq("actor_run_id", jobId)
    .maybeSingle();

  if (runError) {
    throw new Error(`Could not read the run log for ${jobId}: ${runError.message}`);
  }
  if (!run) {
    // Guessing the platform/job type would parse the dataset with the wrong adapter and then
    // delete it, so refuse instead.
    throw new Error(
      `Run ${jobId} has no collection_runs record, so its platform and job type are unknown. It was not ingested.`
    );
  }
  if (run.status === "success") {
    return { state: "succeeded", message: "Data has already been saved." };
  }

  const markFailed = async (errorPayload: Record<string, unknown>, onlyFrom: string[]): Promise<void> => {
    const { error } = await supabase
      .from("collection_runs")
      .update({ status: "failed", completed_at: new Date().toISOString(), error: errorPayload })
      .eq("id", run.id)
      .in("status", onlyFrom);
    if (error) console.error(`[collection_runs] Could not mark run ${jobId} failed:`, error.message);
  };

  // 1. Ask the provider where the run is
  const statusRes = await provider.checkJobStatus(jobId);
  if (!statusRes.isFinished) {
    return { state: "running", message: `Run is still ${statusRes.status}.` };
  }
  if (statusRes.status !== "completed") {
    const reason = statusRes.error || `Provider reported the run as ${statusRes.status}.`;
    await markFailed({ fatal: reason, provider_status: statusRes.status }, ["started"]);
    return { state: "failed", message: reason };
  }

  // 2. Claim the run. Allowed from started / partial / failed (retry), or from a stale
  // 'ingesting' claim left by a request that crashed.
  const staleBefore = new Date(Date.now() - INGEST_CLAIM_TTL_MS).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("collection_runs")
    .update({ status: "ingesting", ingest_claimed_at: new Date().toISOString() })
    .eq("id", run.id)
    .or(
      `status.in.(started,partial,failed),and(status.eq.ingesting,ingest_claimed_at.lt."${staleBefore}")`
    )
    .select("id")
    .maybeSingle();

  if (claimError) {
    throw new Error(`Could not claim run ${jobId} for ingestion: ${claimError.message}`);
  }
  if (!claimed) {
    const { data: latest } = await supabase
      .from("collection_runs")
      .select("status")
      .eq("id", run.id)
      .maybeSingle();
    if (latest?.status === "success") {
      return { state: "succeeded", message: "Data has already been saved." };
    }
    return { state: "ingesting", message: "Another request is saving this run. Checking again shortly." };
  }

  // 3. We own the run: fetch, normalize, ingest. Any throw marks it failed so it can be retried.
  const jobType = run.job_type === "refresh" ? "refresh" : "discovery";
  const platform = run.platform as PlatformType;
  // The day window is "the IST day the run STARTED", not the day it finished saving: a run
  // started at 23:50 IST and saved at 00:10 must keep its posts.
  const runStartedAt = new Date(run.started_at);
  // Refresh runs log the URLs they asked for; read them now (ingestion rewrites `error`).
  const runLog = (run.error ?? null) as { target_urls?: unknown } | null;
  const targetUrls = Array.isArray(runLog?.target_urls)
    ? (runLog.target_urls as unknown[]).filter((u): u is string => typeof u === "string")
    : [];

  try {
    if (!statusRes.datasetOrSnapshotId) {
      throw new Error(`Run ${jobId} completed but returned no dataset or snapshot ID`);
    }

    const rawItems = await provider.fetchDatasetItems(statusRes.datasetOrSnapshotId);
    const normalized = provider.normalizeDataset(rawItems, jobType, platform);
    const strategy = await getScraperRefreshStrategy();

    const summary = await processIngestion(normalized, {
      actorRunId: jobId,
      jobType,
      provider: provider.name,
      platform,
      targetDate: formatDate(runStartedAt),
      dayWindowAnchor: runStartedAt,
      postCapPerAccount: jobType === "discovery" ? strategy.discovery_post_limit : null,
    });

    // Clean up remote storage only after a fully successful save, so a failed or partial
    // ingestion can be retried from the same dataset.
    if (summary.status === "success") {
      await provider.cleanupDataset(statusRes.datasetOrSnapshotId);
    }

    // Capture the real Apify cost of this run (non-fatal if Apify has not published it yet)
    if (provider.name === "apify") {
      await recordRunUsage(jobId);
    }

    // Posts a refresh asked for but got nothing back for (deleted / made private) would otherwise
    // be re-sent, and paid for, on every refresh. Mark them checked so they wait a full interval.
    if (jobType === "refresh" && summary.status !== "failed" && targetUrls.length > 0) {
      await markUnreturnedRefreshTargets(targetUrls, normalized.posts.map((p) => p.url));
    }

    if (summary.status === "failed") {
      return {
        state: "failed",
        summary,
        message: `Saving the run failed: ${summary.errors[summary.errors.length - 1] ?? "unknown error"}`,
      };
    }

    return {
      state: "succeeded",
      summary,
      message:
        summary.status === "partial"
          ? `Saved ${summary.postsUpserted} posts with ${summary.errors.length} error(s). Open Health to retry.`
          : `Saved ${summary.postsUpserted} posts and ${summary.snapshotsCreated} snapshots.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed({ fatal: message }, ["ingesting"]);
    throw err;
  }
}
