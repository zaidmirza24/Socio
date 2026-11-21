import {
  getApifyClientAsync,
  getApifyTaskIdAsync,
  getApifyActorIdAsync,
  verifyWebhookSecretAsync,
  deleteApifyDataset,
  ApifyConfigError,
} from "../../apify/client.ts";
import { getApifyConfig } from "../../services/integrations.ts";
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
  ScraperWebhookResult,
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

    let dynamicInput: Record<string, unknown>;
    let targetActorId: string;
    let taskId: string | null | undefined;

    if (platform === "instagram") {
      const directUrls = cleanHandles.map((handle) => `https://www.instagram.com/${handle}/`);
      const postLimit = options.postLimit || 10;
      dynamicInput = {
        username: cleanHandles,
        usernames: cleanHandles,
        directUrls,
        resultsLimit: postLimit,
        resultsType: "posts",
        searchType: "user",
        ...(options.onlyPostsNewerThan ? { onlyPostsNewerThan: options.onlyPostsNewerThan } : {}),
        ...(options.customInput || {}),
      };
      taskId = await getApifyTaskIdAsync(options.taskId);
      targetActorId = await getApifyActorIdAsync(options.actorId);
    } else {
      const apifyConfig = await getApifyConfig();
      const adapter = getPlatformAdapter(platform);
      const baseInput = adapter.buildDiscoveryInput(cleanHandles, options.onlyPostsNewerThan);
      dynamicInput = {
        ...baseInput,
        ...(options.postLimit ? { resultsLimit: options.postLimit, count: options.postLimit } : {}),
        ...(options.customInput || {}),
      };
      targetActorId = options.actorId || apifyConfig.actors[platform].discovery;
    }

    let run;
    let executionMode: "task" | "actor";
    let executionTarget: string;

    if (taskId && platform === "instagram") {
      executionMode = "task";
      executionTarget = taskId;
      run = await client.task(taskId).start(dynamicInput);
    } else {
      executionMode = "actor";
      executionTarget = targetActorId;
      run = await client.actor(targetActorId).start(dynamicInput);
    }

    return {
      success: true,
      jobId: run.id,
      provider: "apify",
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
      dynamicInput = {
        directUrls: postUrls,
        resultsType: "posts",
        searchType: "hashtag", // Apify Instagram Scraper direct URL mode
        ...(options.customInput || {}),
      };
      targetActorId = await getApifyActorIdAsync();
    } else {
      const apifyConfig = await getApifyConfig();
      const adapter = getPlatformAdapter(platform);
      const baseInput = adapter.buildRefreshInput(postUrls);
      dynamicInput = {
        ...baseInput,
        ...(options.customInput || {}),
      };
      targetActorId = apifyConfig.actors[platform].refresh;
    }

    const run = await client.actor(targetActorId).start(dynamicInput);

    return {
      success: true,
      jobId: run.id,
      provider: "apify",
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
   * Fetches metrics and metadata for a single Instagram post URL synchronously.
   */
  async fetchDirectPost(postUrl: string): Promise<DirectPostDetails | null> {
    try {
      const client = await getApifyClientAsync();
      const actorId = await getApifyActorIdAsync();

      const run = await client.actor(actorId).call({
        directUrls: [postUrl],
        resultsType: "posts",
        searchType: "hashtag",
      });

      if (!run.defaultDatasetId) {
        return null;
      }

      const dataset = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
      await deleteApifyDataset(run.defaultDatasetId);

      const normalized = normalizeApifyInstagramDataset(dataset.items || []);
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
    const run = await client.run(jobId).get();

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
    const dataset = await client.dataset(datasetId).listItems({ clean: true });
    return dataset.items || [];
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

  /**
   * Validates and extracts payload from incoming Apify webhooks.
   */
  async parseWebhook(
    request: Request,
    body: unknown
  ): Promise<ScraperWebhookResult> {
    const url = new URL(request.url);
    const headerSecret = request.headers.get("x-apify-webhook-secret");
    const querySecret = url.searchParams.get("secret");
    const secret = headerSecret || querySecret;

    if (!(await verifyWebhookSecretAsync(secret))) {
      return {
        verified: false,
        jobId: "unverified",
        provider: "apify",
        status: "failed",
        error: "Unauthorized: Invalid or missing Apify webhook secret",
      };
    }

    const payload = body as Record<string, unknown> | null;
    const eventData = payload?.eventData as Record<string, unknown> | undefined;
    const resource = payload?.resource as Record<string, unknown> | undefined;

    const actorRunId =
      (eventData?.actorRunId as string) || (resource?.id as string) || "unknown-run";
    const datasetId =
      (eventData?.defaultDatasetId as string) ||
      (resource?.defaultDatasetId as string) ||
      undefined;
    const runStatus =
      ((eventData?.status as string) || (resource?.status as string) || "SUCCEEDED").toUpperCase();

    if (["FAILED", "TIMED-OUT", "ABORTED"].includes(runStatus)) {
      return {
        verified: true,
        jobId: actorRunId,
        provider: "apify",
        datasetOrSnapshotId: datasetId,
        status: "failed",
        error: `Apify run finished with failure status: ${runStatus}`,
      };
    }

    return {
      verified: true,
      jobId: actorRunId,
      provider: "apify",
      datasetOrSnapshotId: datasetId,
      status: "completed",
    };
  }
}
