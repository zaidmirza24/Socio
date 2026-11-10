import {
  getApifyClient,
  getApifyTaskId,
  getApifyActorId,
  ApifyConfigError,
  deleteApifyDataset,
} from "./client.ts";
import { createAdminClient } from "../supabase/admin.ts";
import { normalizeInstagramDataset } from "../collectors/instagram.ts";
import { formatDate } from "../utils.ts";

export const ACCOUNT_BATCH_SIZE = 100;
export const DIRECT_URL_BATCH_SIZE = 50;

export interface TriggerRunResult {
  success: boolean;
  runId: string;
  defaultDatasetId: string;
  status: string;
  accountsCount: number;
  targetHandles: string[];
  executionMode: "task" | "actor";
  executionTarget: string;
  onlyPostsNewerThan?: string;
  batchIndex?: number;
  totalBatches?: number;
}

export interface TriggerOptions {
  taskId?: string;
  actorId?: string;
  postLimit?: number;
  customHandles?: string[];
  customInput?: Record<string, unknown>;
  onlyPostsNewerThan?: string;
}

/**
 * Pre-flight validation result returned before attempting to start a run.
 */
export interface PreflightResult {
  valid: boolean;
  errors: string[];
  activeAccountCount: number;
  executionMode: "task" | "actor";
  executionTarget: string;
}

/**
 * Helper to fetch the earliest release date among all active campaign captions.
 * Used to populate `onlyPostsNewerThan` so scrapers ignore older historical posts.
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

    // Safety buffer: Look back 7 days prior to earliest release date
    // to absorb timezone differences, same-day scheduling lag, and early volunteer posts
    const date = new Date(data.released_at);
    date.setDate(date.getDate() - 7);
    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

/**
 * Validates all prerequisites before starting a scraper run.
 * Returns detailed, actionable errors for anything misconfigured.
 */
export async function preflightCheck(options: TriggerOptions = {}): Promise<PreflightResult> {
  const errors: string[] = [];
  let activeAccountCount = 0;

  // 1. Validate Apify client can be created (checks token)
  try {
    getApifyClient();
  } catch (err: unknown) {
    if (err instanceof ApifyConfigError) {
      errors.push(err.message);
    } else {
      errors.push(
        "Failed to initialize Apify client: " + (err instanceof Error ? err.message : String(err))
      );
    }
  }

  // 2. Check execution target
  const taskId = getApifyTaskId(options.taskId);
  const actorId = getApifyActorId(options.actorId);
  const executionMode: "task" | "actor" = taskId ? "task" : "actor";
  const executionTarget = taskId || actorId;

  // 3. Check active accounts
  if (options.customHandles && options.customHandles.length > 0) {
    activeAccountCount = options.customHandles.length;
  } else {
    try {
      const supabase = createAdminClient();
      const { data: accounts, error: accError } = await supabase
        .from("accounts")
        .select("handle")
        .eq("platform", "instagram")
        .eq("status", "active");

      if (accError) {
        errors.push(`Database error while querying accounts: ${accError.message}`);
      } else if (!accounts || accounts.length === 0) {
        errors.push(
          "No active Instagram accounts found in the database. " +
            "Go to the Accounts page to add volunteer profiles before running the scraper."
        );
      } else {
        activeAccountCount = accounts.length;
      }
    } catch (err: unknown) {
      errors.push(
        "Failed to connect to database: " + (err instanceof Error ? err.message : String(err))
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    activeAccountCount,
    executionMode,
    executionTarget,
  };
}

/**
 * Triggers an on-demand Apify Task/Actor run using active accounts from Supabase.
 * Automatically injects `onlyPostsNewerThan` boundary from active captions.
 */
export async function triggerApifyTaskRun(
  options: TriggerOptions = {}
): Promise<TriggerRunResult> {
  // 1. Run preflight validation
  const preflight = await preflightCheck(options);
  if (!preflight.valid) {
    throw new ApifyConfigError("Pre-flight check failed:\n• " + preflight.errors.join("\n• "));
  }

  const supabase = createAdminClient();
  const client = getApifyClient();

  // 2. Determine target accounts
  let targetHandles: string[];

  if (options.customHandles && options.customHandles.length > 0) {
    targetHandles = options.customHandles.map((h) => h.replace(/^@/, "").trim().toLowerCase());
  } else {
    const { data: accounts, error: accError } = await supabase
      .from("accounts")
      .select("handle")
      .eq("platform", "instagram")
      .eq("status", "active");

    if (accError) {
      throw new Error(`Database error querying active accounts: ${accError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      throw new Error("No active Instagram accounts found. Add accounts in the Accounts tab first.");
    }

    targetHandles = accounts.map((a) => a.handle.replace(/^@/, "").trim().toLowerCase());
  }

  const postLimit = options.postLimit || 10;
  const directUrls = targetHandles.map((handle) => `https://www.instagram.com/${handle}/`);

  // 3. Determine earliest date boundary
  const newerThan = options.onlyPostsNewerThan || (await getEarliestActiveCaptionDate());

  // 4. Build dynamic input payload for the Instagram Scraper
  const dynamicInput: Record<string, unknown> = {
    usernames: targetHandles,
    directUrls,
    resultsLimit: postLimit,
    resultsType: "posts",
    searchType: "user",
    ...(newerThan ? { onlyPostsNewerThan: newerThan } : {}),
    ...(options.customInput || {}),
  };

  // 5. Resolve execution mode
  const taskId = getApifyTaskId(options.taskId);
  const actorId = getApifyActorId(options.actorId);

  // 6. Start Apify execution
  let run;
  let executionMode: "task" | "actor";
  let executionTarget: string;

  try {
    if (taskId) {
      executionMode = "task";
      executionTarget = taskId;
      run = await client.task(taskId).start(dynamicInput);
    } else {
      executionMode = "actor";
      executionTarget = actorId;
      run = await client.actor(actorId).start(dynamicInput);
    }
  } catch (err: unknown) {
    const target = taskId ? `Task "${taskId}"` : `Actor "${actorId}"`;
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to start Apify ${target}: ${detail}`);
  }

  // 7. Log initial run into collection_runs
  try {
    await supabase.from("collection_runs").insert({
      actor_run_id: run.id,
      platform: "instagram",
      started_at: new Date().toISOString(),
      status: "started",
      accounts_targeted: targetHandles.length,
      posts_found: 0,
      posts_upserted: 0,
      snapshots_created: 0,
      error: { targeted_handles: targetHandles },
    });
  } catch (logErr: unknown) {
    console.error(
      "[collection_runs] Failed to log run start:",
      logErr instanceof Error ? logErr.message : logErr
    );
  }

  return {
    success: true,
    runId: run.id,
    defaultDatasetId: run.defaultDatasetId,
    status: run.status,
    accountsCount: targetHandles.length,
    targetHandles,
    executionMode,
    executionTarget,
    onlyPostsNewerThan: newerThan ?? undefined,
  };
}

/**
 * Triggers batched scraper runs (chunks of up to 100 accounts per batch)
 * as specified in Architecture V2 for ~700 accounts.
 */
export async function triggerBatchApifyRuns(
  options: TriggerOptions = {}
): Promise<TriggerRunResult[]> {
  const supabase = createAdminClient();
  let allHandles: string[];

  if (options.customHandles && options.customHandles.length > 0) {
    allHandles = options.customHandles.map((h) => h.replace(/^@/, "").trim().toLowerCase());
  } else {
    const { data: accounts, error: accError } = await supabase
      .from("accounts")
      .select("handle")
      .eq("platform", "instagram")
      .eq("status", "active");

    if (accError) {
      throw new Error(`Database error querying active accounts: ${accError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      throw new Error("No active Instagram accounts found.");
    }

    allHandles = accounts.map((a) => a.handle.replace(/^@/, "").trim().toLowerCase());
  }

  // Partition handles into chunks of ACCOUNT_BATCH_SIZE (100)
  const chunks: string[][] = [];
  for (let i = 0; i < allHandles.length; i += ACCOUNT_BATCH_SIZE) {
    chunks.push(allHandles.slice(i, i + ACCOUNT_BATCH_SIZE));
  }

  const results: TriggerRunResult[] = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkHandles = chunks[idx];
    const runResult = await triggerApifyTaskRun({
      ...options,
      customHandles: chunkHandles,
    });

    results.push({
      ...runResult,
      batchIndex: idx + 1,
      totalBatches: chunks.length,
    });
  }

  return results;
}

/**
 * Refreshes tracked campaign posts that have fallen outside the top-10 recent feed window.
 * Executes direct URL fetch in batches of up to 50 URLs, updates metric_snapshots,
 * and deletes Apify datasets immediately after ingestion.
 */
export async function refreshTrackedPostsOutsideWindow(options: {
  maxBatchSize?: number;
} = {}): Promise<{
  refreshedCount: number;
  errors: string[];
}> {
  const supabase = createAdminClient();
  const client = getApifyClient();
  const actorId = getApifyActorId();
  const targetDate = formatDate();
  const errors: string[] = [];
  let refreshedCount = 0;

  const batchSize = options.maxBatchSize || DIRECT_URL_BATCH_SIZE;

  // 1. Query active tracked posts
  const { data: trackedPosts, error: trackedError } = await supabase
    .from("matched_posts")
    .select("id, post_url, platform_post_id, caption_id, account_id, platform")
    .eq("platform", "instagram")
    .eq("tracking_status", "tracking");

  if (trackedError || !trackedPosts || trackedPosts.length === 0) {
    return { refreshedCount: 0, errors: trackedError ? [trackedError.message] : [] };
  }

  // 2. Filter out posts that already have a snapshot for today
  const { data: todaySnapshots } = await supabase
    .from("metric_snapshots")
    .select("post_id")
    .eq("snapshot_date", targetDate);

  const existingPostIds = new Set((todaySnapshots || []).map((s) => s.post_id));
  const postsToRefresh = trackedPosts.filter((p) => !existingPostIds.has(p.id));

  if (postsToRefresh.length === 0) {
    return { refreshedCount: 0, errors: [] };
  }

  // 3. Chunk URLs into batches of 50
  const urlBatches: typeof postsToRefresh[] = [];
  for (let i = 0; i < postsToRefresh.length; i += batchSize) {
    urlBatches.push(postsToRefresh.slice(i, i + batchSize));
  }

  // 4. Process each batch with direct URL scraper
  for (const batch of urlBatches) {
    const urls = batch.map((p) => p.post_url);
    const postMapByUrl = new Map<string, (typeof batch)[0]>();
    const postMapById = new Map<string, (typeof batch)[0]>();

    for (const p of batch) {
      postMapByUrl.set(p.post_url, p);
      postMapById.set(p.platform_post_id, p);
    }

    try {
      // Execute actor synchronously
      const run = await client.actor(actorId).call({
        directUrls: urls,
        resultsType: "posts",
        searchType: "hashtag", // Scraper direct URL mode
      });

      if (!run.defaultDatasetId) {
        errors.push(`Direct URL fetch run ${run.id} returned no dataset ID`);
        continue;
      }

      // List dataset items
      const dataset = await client.dataset(run.defaultDatasetId).listItems({
        clean: true,
      });

      const rawItems = dataset.items || [];

      // Zero data retention: wipe dataset from Apify servers
      await deleteApifyDataset(run.defaultDatasetId);

      // Normalize items
      const normalized = normalizeInstagramDataset(rawItems);

      // Upsert metrics for matched posts
      for (const item of normalized.posts) {
        const matched = postMapById.get(item.platform_post_id) || postMapByUrl.get(item.url);
        if (!matched) continue;

        // Fetch previous snapshot to compute deltas
        const { data: prevSnapshot } = await supabase
          .from("metric_snapshots")
          .select("likes, comments, views")
          .eq("post_id", matched.id)
          .lt("snapshot_date", targetDate)
          .order("snapshot_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        const prevLikes = prevSnapshot?.likes ?? null;
        const prevComments = prevSnapshot?.comments ?? null;
        const prevViews = prevSnapshot?.views ?? null;

        const deltaLikes =
          item.metrics.likes !== null && prevLikes !== null
            ? Math.max(0, item.metrics.likes - prevLikes)
            : 0;
        const deltaComments =
          item.metrics.comments !== null && prevComments !== null
            ? Math.max(0, item.metrics.comments - prevComments)
            : 0;
        const deltaViews =
          item.metrics.views !== null && prevViews !== null
            ? Math.max(0, item.metrics.views - prevViews)
            : 0;

        await supabase.from("metric_snapshots").upsert(
          {
            post_id: matched.id,
            snapshot_date: targetDate,
            likes: item.metrics.likes,
            comments: item.metrics.comments,
            views: item.metrics.views,
            delta_likes: deltaLikes,
            delta_comments: deltaComments,
            delta_views: deltaViews,
            source: "direct_url",
            fetched_at: new Date().toISOString(),
          },
          {
            onConflict: "post_id,snapshot_date",
          }
        );

        // Mirror to legacy posts and post_snapshots for Analytics and KPIs
        try {
          const { data: legacyPost } = await supabase
            .from("posts")
            .upsert(
              {
                account_id: matched.account_id,
                platform: item.platform,
                platform_post_id: item.platform_post_id,
                url: item.url,
                caption: item.caption,
                media_type: item.media_type,
                posted_at: item.posted_at,
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
                likes: item.metrics.likes,
                comments: item.metrics.comments,
                shares: item.metrics.shares,
                views: item.metrics.views,
                raw_json: item.raw_json,
              },
              {
                onConflict: "post_id,snapshot_date",
              }
            );
          }
        } catch {
          // Non-fatal legacy sync
        }

        refreshedCount++;
      }
    } catch (batchErr: unknown) {
      errors.push(
        `Failed direct URL batch: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`
      );
    }
  }

  return { refreshedCount, errors };
}

export interface DirectPostDetails {
  likes: number | null;
  comments: number | null;
  views: number | null;
  postedAt: string;
  mediaType: string;
  rawJson?: Record<string, unknown>;
}

/**
 * Fetches current engagement metrics and metadata for a single Instagram post via Apify.
 * Used during review approval and ad-hoc post inspection.
 */
export async function fetchDirectPostDetails(
  postUrl: string
): Promise<DirectPostDetails | null> {
  try {
    const client = getApifyClient();
    const actorId = getApifyActorId();

    const run = await client.actor(actorId).call({
      directUrls: [postUrl],
      resultsType: "posts",
      searchType: "hashtag",
    });

    if (!run.defaultDatasetId) {
      return null;
    }

    const dataset = await client.dataset(run.defaultDatasetId).listItems({
      clean: true,
    });

    await deleteApifyDataset(run.defaultDatasetId);

    const normalized = normalizeInstagramDataset(dataset.items || []);
    if (normalized.posts.length > 0) {
      const p = normalized.posts[0];
      return {
        likes: p.metrics.likes,
        comments: p.metrics.comments,
        views: p.metrics.views,
        postedAt: p.posted_at,
        mediaType: p.media_type || "Post",
        rawJson: p.raw_json,
      };
    }

    return null;
  } catch (err: unknown) {
    console.warn("fetchDirectPostDetails failed:", err);
    return null;
  }
}
