import {
  getApifyClientAsync,
  getApifyTaskIdAsync,
  getApifyActorIdAsync,
  deleteApifyDataset,
  ApifyConfigError,
  ApifyRunAccessError,
  isApifyPermissionError,
} from "../../apify/client.ts";
import { getApifyConfig } from "../../services/integrations.ts";
import {
  APIFY_RUN_MEMORY_MB,
  APIFY_RUN_TIMEOUT_SECS,
  APIFY_DIRECT_POST_TIMEOUT_SECS,
  APIFY_DATASET_PAGE_SIZE,
} from "../../config/batching.ts";
import { getServerEnv } from "../../env.ts";
import { getScraperRefreshStrategy } from "../../services/settings.ts";
import { buildRunWebhooks } from "./webhook.ts";

/**
 * Start options for a run: memory, a time limit, the admin's per-run cost cap (Settings), plus the
 * end-of-run webhook when one is configured.
 */
async function runStartOptions(platform: PlatformType) {
  const env = getServerEnv();
  const { max_run_cost_usd } = await getScraperRefreshStrategy();
  const webhooks = buildRunWebhooks({
    baseUrl: env.APIFY_WEBHOOK_BASE_URL,
    secret: env.APIFY_WEBHOOK_SECRET,
  });
  return {
    memory: APIFY_RUN_MEMORY_MB[platform],
    timeout: APIFY_RUN_TIMEOUT_SECS,
    ...(max_run_cost_usd ? { maxTotalChargeUsd: max_run_cost_usd } : {}),
    ...(webhooks.length > 0 ? { webhooks } : {}),
  };
}
import { buildDiscoveryRunInput } from "../discovery-input.ts";
import { normalizeApifyInstagramDataset, type AdapterResult } from "./adapter.ts";
import { getPlatformAdapter, normalizePlatformDataset } from "../platform-adapter.ts";
import type {
  IScraperProvider,
  ScraperDiscoveryOptions,
  ScraperRefreshOptions,
  ScraperJobTriggerResult,
  ScraperJobStatusResult,
  DirectPostDetails,
  ScraperPreflightResult,
} from "../types.ts";
import type { NormalizedPostItem, NormalizedAccountItem, ScraperJobType, PlatformType } from "../../../types/database.ts";

export class ApifyScraperProvider implements IScraperProvider {
  readonly name = "apify" as const;

  /**
   * Validates Apify credentials and configuration before execution.
   */
  async validateConfiguration(): Promise<ScraperPreflightResult> {
    const errors: string[] = [];
    try {
      await getApifyClientAsync();
    } catch (err: unknown) {
      if (err instanceof ApifyConfigError) {
        errors.push(err.message);
      } else {
        errors.push(
          "Failed to initialize Apify client: " +
            (err instanceof Error ? err.message : String(err))
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      provider: "apify",
    };
  }

  /**
   * Starts a daily discovery run targeting specified usernames/profiles.
   */
  async startDiscoveryJob(
    handles: string[],
    options: ScraperDiscoveryOptions = {}
  ): Promise<ScraperJobTriggerResult> {
    const client = await getApifyClientAsync();
    const platform = options.platform || "instagram";
    const cleanHandles = handles.map((h) => h.replace(/^@/, "").trim().toLowerCase());

    let targetActorId: string;
    let taskId: string | null | undefined;

    const dynamicInput = buildDiscoveryRunInput(platform, cleanHandles, {
      postLimit: options.postLimit,
      onlyPostsNewerThan: options.onlyPostsNewerThan,
    });
    if (platform === "instagram") {
      taskId = await getApifyTaskIdAsync(options.taskId);
      targetActorId = await getApifyActorIdAsync(options.actorId);
    } else {
      const apifyConfig = await getApifyConfig();
      targetActorId = options.actorId || apifyConfig.actors[platform].discovery;
    }

    let run;
    let executionMode: "task" | "actor";
    let executionTarget: string;

    if (taskId && platform === "instagram") {
      executionMode = "task";
      executionTarget = taskId;
      run = await client.task(taskId).start(dynamicInput, await runStartOptions(platform));
    } else {
      executionMode = "actor";
      executionTarget = targetActorId;
      run = await client.actor(targetActorId).start(dynamicInput, await runStartOptions(platform));
    }

    return {
      success: true,
      jobId: run.id,
      provider: "apify",
      accountId: run.userId,
      jobType: "discovery",
      datasetOrSnapshotId: run.defaultDatasetId,
      status: run.status,
      accountsCount: cleanHandles.length,
      targetCount: cleanHandles.length,
      targets: cleanHandles,
      executionMode,
      executionTarget,
      onlyPostsNewerThan: options.onlyPostsNewerThan,
    };
  }

  /**
   * Starts an existing-post engagement refresh job targeting specific post URLs.
   */
  async startRefreshJob(
    postUrls: string[],
    options: ScraperRefreshOptions = {}
  ): Promise<ScraperJobTriggerResult> {
    const client = await getApifyClientAsync();
    const platform = options.platform || "instagram";

    let dynamicInput: Record<string, unknown>;
    let targetActorId: string;

    if (platform === "instagram") {
      // This actor requires `username`; it accepts direct post URLs there (verified against the live
      // actor). `directUrls` alone is rejected with "Field input.username is required".
      dynamicInput = {
        username: postUrls,
        resultsLimit: 1,
      };
      // Honour the refresh actor configured in Settings (defaults to the discovery actor).
      targetActorId = (await getApifyConfig()).actors.instagram.refresh;
    } else {
      const apifyConfig = await getApifyConfig();
      const adapter = getPlatformAdapter(platform);
      dynamicInput = adapter.buildRefreshInput(postUrls);
      targetActorId = apifyConfig.actors[platform].refresh;
    }

    const run = await client.actor(targetActorId).start(dynamicInput, await runStartOptions(platform));

    return {
      success: true,
      jobId: run.id,
      provider: "apify",
      accountId: run.userId,
      jobType: "refresh",
      datasetOrSnapshotId: run.defaultDatasetId,
      status: run.status,
      accountsCount: 0,
      targetCount: postUrls.length,
      targets: postUrls,
      executionMode: "actor",
      executionTarget: targetActorId,
    };
  }

  /**
   * Fetches metrics and metadata for a single post URL synchronously, using the platform's
   * refresh actor (so Facebook and X review items can be approved too).
   */
  async fetchDirectPost(postUrl: string, platform: PlatformType = "instagram"): Promise<DirectPostDetails | null> {
    try {
      const client = await getApifyClientAsync();
      const apifyConfig = await getApifyConfig();

      const input =
        platform === "instagram"
          ? { username: [postUrl], resultsLimit: 1 } // actor requires `username`; accepts post URLs
          : getPlatformAdapter(platform).buildRefreshInput([postUrl]);
      // This runs inside a request, so bound it: a stuck actor must not hang the caller.
      const { max_run_cost_usd } = await getScraperRefreshStrategy();
      const run = await client.actor(apifyConfig.actors[platform].refresh).call(input, {
        memory: APIFY_RUN_MEMORY_MB[platform],
        timeout: APIFY_DIRECT_POST_TIMEOUT_SECS,
        waitSecs: APIFY_DIRECT_POST_TIMEOUT_SECS,
        ...(max_run_cost_usd ? { maxTotalChargeUsd: max_run_cost_usd } : {}),
      });

      if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
        return null;
      }

      const items = await this.fetchDatasetItems(run.defaultDatasetId);
      const dataset = { items };
      await deleteApifyDataset(run.defaultDatasetId);

      const normalized =
        platform === "instagram"
          ? normalizeApifyInstagramDataset(dataset.items || [])
          : normalizePlatformDataset(platform, dataset.items || []);
      if (normalized.posts.length > 0) {
        const p = normalized.posts[0];
        return {
          likes: p.metrics.likes,
          comments: p.metrics.comments,
          views: p.metrics.views,
          postedAt: p.posted_at,
          mediaType: p.media_type || "Post",
          thumbnailUrl: p.thumbnail_url,
          rawJson: p.raw_json,
        };
      }

      return null;
    } catch (err: unknown) {
      console.warn("[ApifyProvider] fetchDirectPost failed:", err);
      return null;
    }
  }

  /**
   * Checks the live status of an Apify actor or task run.
   */
  async checkJobStatus(jobId: string): Promise<ScraperJobStatusResult> {
    const client = await getApifyClientAsync();
    let run;
    try {
      run = await client.run(jobId).get();
    } catch (err: unknown) {
      if (isApifyPermissionError(err)) {
        throw new ApifyRunAccessError(`The saved Apify token cannot read run ${jobId}.`);
      }
      throw err;
    }

    if (!run) {
      return {
        jobId,
        provider: "apify",
        status: "failed",
        isFinished: true,
        error: `Apify run with ID ${jobId} not found`,
      };
    }

    const rawStatus = run.status;
    let mappedStatus: "pending" | "running" | "completed" | "failed" = "running";
    let isFinished = false;

    if (rawStatus === "READY") {
      mappedStatus = "pending";
    } else if (rawStatus === "RUNNING") {
      mappedStatus = "running";
    } else if (rawStatus === "SUCCEEDED") {
      mappedStatus = "completed";
      isFinished = true;
    } else if (["FAILED", "TIMED-OUT", "ABORTED"].includes(rawStatus)) {
      mappedStatus = "failed";
      isFinished = true;
    }

    return {
      jobId: run.id,
      provider: "apify",
      status: mappedStatus,
      isFinished,
      datasetOrSnapshotId: run.defaultDatasetId,
      startedAt: run.startedAt ? new Date(run.startedAt).toISOString() : undefined,
      completedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : undefined,
      error: mappedStatus === "failed" ? `Run ended with Apify status: ${rawStatus}` : undefined,
    };
  }

  /**
   * Fetches dataset items by Apify defaultDatasetId.
   */
  async fetchDatasetItems(datasetId: string): Promise<unknown[]> {
    const client = await getApifyClientAsync();
    // Read in pages: one request for a whole day's items (thousands of raw posts) is slow and can
    // time out. `total` comes back with every page, so stop once we have it all.
    const items: unknown[] = [];
    for (let offset = 0; ; offset += APIFY_DATASET_PAGE_SIZE) {
      const page = await client
        .dataset(datasetId)
        .listItems({ clean: true, offset, limit: APIFY_DATASET_PAGE_SIZE });
      items.push(...(page.items ?? []));
      // `clean` can drop empty items, so a page may be shorter than the limit; rely on offset vs total.
      if (page.total <= offset + APIFY_DATASET_PAGE_SIZE || page.count === 0) break;
    }
    return items;
  }

  /**
   * Normalizes raw Apify items into typed domain models.
   */
  normalizeDataset(
    rawItems: unknown[],
    _jobType: ScraperJobType,
    platform: PlatformType = "instagram"
  ): {
    posts: NormalizedPostItem[];
    accounts: Map<string, NormalizedAccountItem>;
  } {
    return normalizePlatformDataset(platform, rawItems);
  }

  /**
   * Zero-retention cleanup of Apify datasets.
   */
  async cleanupDataset(datasetId: string): Promise<boolean> {
    return deleteApifyDataset(datasetId);
  }
}
