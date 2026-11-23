import type { NormalizedPostItem, NormalizedAccountItem, ScraperJobType } from "../../types/database.ts";

export type ScraperProviderType = "apify" | "brightdata";

export interface ScraperDiscoveryOptions {
  platform?: import("../../types/database.ts").PlatformType;
  postLimit?: number;
  onlyPostsNewerThan?: string;
  customHandles?: string[];
  /** Limit the run to these volunteers' accounts. Omit to run every active account. */
  volunteerIds?: string[];
  taskId?: string;
  actorId?: string;
}

export interface ScraperRefreshOptions {
  platform?: import("../../types/database.ts").PlatformType;
  postUrls?: string[];
}

export interface ScraperJobTriggerResult {
  success: boolean;
  jobId: string;
  provider: ScraperProviderType;
  jobType: ScraperJobType;
  /** Provider account that owns the run (Apify user id), when the provider reports it. */
  accountId?: string;
  datasetOrSnapshotId?: string;
  status: string;
  accountsCount: number;
  targetCount: number;
  targets: string[];
  executionMode?: "task" | "actor" | "dataset";
  executionTarget?: string;
  onlyPostsNewerThan?: string;
}

export interface ScraperJobStatusResult {
  jobId: string;
  provider: ScraperProviderType;
  status: "pending" | "running" | "completed" | "failed";
  isFinished: boolean;
  datasetOrSnapshotId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  rawItems?: unknown[];
}

export interface DirectPostDetails {
  likes: number | null;
  comments: number | null;
  views: number | null;
  postedAt: string;
  mediaType: string;
  thumbnailUrl?: string | null;
  rawJson?: Record<string, unknown>;
}

export interface ScraperPreflightResult {
  valid: boolean;
  errors: string[];
  activeAccountCount?: number;
  provider: ScraperProviderType;
}

export interface IScraperProvider {
  readonly name: ScraperProviderType;

  validateConfiguration(): Promise<ScraperPreflightResult>;

  startDiscoveryJob(
    handles: string[],
    options?: ScraperDiscoveryOptions
  ): Promise<ScraperJobTriggerResult>;

  startRefreshJob(
    postUrls: string[],
    options?: ScraperRefreshOptions
  ): Promise<ScraperJobTriggerResult>;

  fetchDirectPost(postUrl: string, platform?: import("../../types/database.ts").PlatformType): Promise<DirectPostDetails | null>;

  checkJobStatus(jobId: string): Promise<ScraperJobStatusResult>;

  fetchDatasetItems(datasetOrSnapshotId: string): Promise<unknown[]>;

  normalizeDataset(
    rawItems: unknown[],
    jobType: ScraperJobType,
    platform?: import("../../types/database.ts").PlatformType
  ): {
    posts: NormalizedPostItem[];
    accounts: Map<string, NormalizedAccountItem>;
  };

  cleanupDataset(datasetOrSnapshotId: string): Promise<boolean>;
}
