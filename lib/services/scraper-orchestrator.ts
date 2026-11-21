import { createAdminClient } from "../supabase/admin.ts";
import { getScraperProvider } from "../scrapers/factory.ts";
import { getScraperRefreshStrategy, getPlatformSettings } from "./settings.ts";
import { recordRunUsage } from "./apify-usage.ts";
import { processIngestion, type IngestionSummary } from "./ingestion.ts";
import { getScrapeBoundaryDate } from "../utils/day-window.ts";
import type { PlatformType } from "../../types/database.ts";
import type {
  ScraperDiscoveryOptions,
  ScraperRefreshOptions,
  ScraperJobTriggerResult,
  ScraperJobStatusResult,
  DirectPostDetails,
  ScraperProviderType,
} from "../scrapers/types.ts";

export const DEFAULT_DIRECT_URL_BATCH_SIZE = 50;

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

  // 2. Resolve target handles
  let targetHandles: string[];
  if (options.customHandles && options.customHandles.length > 0) {
    targetHandles = options.customHandles.map((h) => h.replace(/^@/, "").trim().toLowerCase());
  } else {
    const { data: accounts, error: accError } = await supabase
      .from("accounts")
      .select("handle")
      .eq("platform", platform)
      .eq("status", "active");

    if (accError) {
      throw new Error(`Database error querying active accounts: ${accError.message}`);
    }

    if (!accounts || accounts.length === 0) {
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

  // 5. Audit log in collection_runs
  try {
    await supabase.from("collection_runs").insert({
      actor_run_id: triggerResult.jobId,
      platform,
      provider: provider.name,
      job_type: "discovery",
      started_at: new Date().toISOString(),
      status: "started",
      accounts_targeted: targetHandles.length,
      posts_found: 0,
      posts_upserted: 0,
      snapshots_created: 0,
      error: { targeted_handles: targetHandles },
    });
  } catch (logErr: unknown) {
    console.error("[collection_runs] Failed to log discovery run start:", logErr);
  }

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

  let matchedQuery = supabase
    .from("matched_posts")
    .select("post_url, last_metrics_refresh_at")
    .eq("platform", platform)
    .eq("tracking_status", "tracking");
  if (ageCutoff) {
    matchedQuery = matchedQuery.gte("posted_at", ageCutoff);
  }

  const matchedRes = await matchedQuery;
  if (matchedRes.error) {
    throw new Error(`Failed to query tracked posts for refresh: ${matchedRes.error.message}`);
  }

  const byUrl = new Map<string, RefreshCandidate>();

  // Also refresh every stored post, including unfiltered ones saved while Campaign Captions
  // was OFF. (With captions always ON, `posts` only mirrors matched posts, so nothing changes.)
  let allQuery = supabase
    .from("posts")
    .select("url, last_metrics_refresh_at")
    .eq("platform", platform);
  if (ageCutoff) {
    allQuery = allQuery.gte("posted_at", ageCutoff);
  }
  const allRes = await allQuery;
  if (allRes.error) {
    throw new Error(`Failed to query stored posts for refresh: ${allRes.error.message}`);
  }
  for (const p of allRes.data ?? []) {
    byUrl.set(p.url, { url: p.url, last_metrics_refresh_at: p.last_metrics_refresh_at });
  }
  // matched_posts wins on conflict (its refresh timestamp is the authoritative one)
  for (const p of matchedRes.data ?? []) {
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
  } = {}
): Promise<{
  success: boolean;
  jobIds: string[];
  eligiblePostsCount: number;
  dispatchedBatchesCount: number;
  message: string;
}> {
  const platform: PlatformType = options.platform || "instagram";
  await assertPlatformEnabled(platform);
  const provider = getScraperProvider(options.providerOverride);
  const strategy = await getScraperRefreshStrategy();
  const supabase = createAdminClient();
  const now = new Date();

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

    // Filter to posts whose last refresh was >= refresh_interval_days ago (or newly discovered / null)
    const eligible = posts.filter(
      (p) => !p.last_metrics_refresh_at || p.last_metrics_refresh_at <= refreshThreshold
    );

    targetUrls = eligible.map((p) => p.url);
  }

  if (targetUrls.length === 0) {
    return {
      success: true,
      jobIds: [],
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

  const jobIds: string[] = [];

  // 4. Dispatch each batch to the active scraper provider
  for (const batch of batches) {
    const triggerRes = await provider.startRefreshJob(batch, { platform });
    jobIds.push(triggerRes.jobId);

    // Audit log in collection_runs
    try {
      await supabase.from("collection_runs").insert({
        actor_run_id: triggerRes.jobId,
        platform,
        provider: provider.name,
        job_type: "refresh",
        started_at: new Date().toISOString(),
        status: "started",
        accounts_targeted: 0,
        posts_found: batch.length,
        posts_upserted: 0,
        snapshots_created: 0,
        error: { target_urls: batch },
      });
    } catch (logErr: unknown) {
      console.error("[collection_runs] Failed to log refresh run start:", logErr);
    }
  }

  return {
    success: true,
    jobIds,
    eligiblePostsCount: targetUrls.length,
    dispatchedBatchesCount: batches.length,
    message: `Dispatched ${batches.length} batch(es) for ${targetUrls.length} post(s) due for ${strategy.refresh_interval_days}-day refresh.`,
  };
}

/**
 * Fetches current engagement details for a single post URL via the active provider.
 * Used during review approvals and single-post inspections.
 */
export async function fetchSinglePostDetails(
  postUrl: string,
  providerOverride?: ScraperProviderType
): Promise<DirectPostDetails | null> {
  const provider = getScraperProvider(providerOverride);
  return provider.fetchDirectPost(postUrl);
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

/**
 * Handles completed scraper job ingestion idempotently.
 */
export async function ingestCompletedJob(
  jobId: string,
  providerOverride?: ScraperProviderType,
  jobType: "discovery" | "refresh" = "discovery"
): Promise<{
  ingested: boolean;
  summary?: IngestionSummary;
  message: string;
}> {
  const provider = getScraperProvider(providerOverride);
  const supabase = createAdminClient();

  // Check if this run was already successfully ingested
  const { data: existingLog } = await supabase
    .from("collection_runs")
    .select("status, posts_upserted, snapshots_created, job_type, platform")
    .eq("actor_run_id", jobId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingLog && existingLog.status === "success") {
    return {
      ingested: true,
      message: "Data has already been ingested into Supabase.",
    };
  }

  // Check status with provider
  const statusRes = await provider.checkJobStatus(jobId);
  if (!statusRes.isFinished || statusRes.status !== "completed") {
    return {
      ingested: false,
      message: `Job is not completed yet (status: ${statusRes.status})`,
    };
  }

  if (!statusRes.datasetOrSnapshotId) {
    throw new Error(`Job ${jobId} completed but returned no dataset or snapshot ID`);
  }

  // Fetch dataset items
  const rawItems = await provider.fetchDatasetItems(statusRes.datasetOrSnapshotId);

  // Determine actual jobType and platform from collection_runs if available
  const resolvedJobType = (existingLog?.job_type as "discovery" | "refresh") || jobType;
  const resolvedPlatform = (existingLog?.platform as PlatformType) || "instagram";

  // Normalize dataset using platform adapter
  const normalized = provider.normalizeDataset(rawItems, resolvedJobType, resolvedPlatform);

  // Ingest via canonical ingestion pipeline
  const summary = await processIngestion(normalized, {
    actorRunId: jobId,
    jobType: resolvedJobType,
    provider: provider.name,
    platform: resolvedPlatform,
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

  return {
    ingested: true,
    summary,
    message: `Successfully ingested ${summary.postsUpserted} posts and ${summary.snapshotsCreated} snapshots.`,
  };
}
