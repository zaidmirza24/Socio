import type { PlatformType, NormalizedPostItem, NormalizedAccountItem } from "../../types/database.ts";
import type { AdapterResult } from "./apify/adapter.ts";
import { normalizeApifyInstagramDataset } from "./apify/adapter.ts";
import { FacebookAdapter, normalizeFacebookDataset } from "./facebook/adapter.ts";
import { TwitterAdapter, normalizeTwitterDataset } from "./twitter/adapter.ts";

export type { AdapterResult };

/**
 * Standard interface for platform-specific scraping adapters.
 * Each platform (Instagram, Facebook, X/Twitter) implements this interface
 * to encapsulate its input generation and output normalization logic cleanly.
 */
export interface IPlatformAdapter {
  readonly platform: PlatformType;

  /**
   * Generates actor input JSON for daily discovery (recent posts for handles).
   */
  buildDiscoveryInput(handles: string[], newerThanDate?: string): Record<string, unknown>;

  /**
   * Generates actor input JSON for Part B 7-day engagement refresh (direct post URLs).
   */
  buildRefreshInput(postUrls: string[]): Record<string, unknown>;

  /**
   * Normalizes raw Apify dataset items into canonical NormalizedPostItem[] and accounts.
   */
  normalizeRawItems(items: unknown[]): AdapterResult;
}

/**
 * Instagram platform adapter wrapper implementing IPlatformAdapter.
 */
export class InstagramAdapter implements IPlatformAdapter {
  readonly platform = "instagram" as const;

  buildDiscoveryInput(handles: string[], newerThanDate?: string): Record<string, unknown> {
    const input: Record<string, unknown> = {
      username: handles,
      resultsLimit: 10,
    };
    if (newerThanDate) {
      input.onlyPostsNewerThan = newerThanDate;
    }
    return input;
  }

  buildRefreshInput(postUrls: string[]): Record<string, unknown> {
    return {
      username: postUrls,
    };
  }

  normalizeRawItems(items: unknown[]): AdapterResult {
    return normalizeApifyInstagramDataset(items);
  }
}

/**
 * Registry resolving IPlatformAdapter for a given platform.
 */
export function getPlatformAdapter(platform: PlatformType): IPlatformAdapter {
  switch (platform) {
    case "facebook":
      return new FacebookAdapter();
    case "x":
      return new TwitterAdapter();
    case "instagram":
    default:
      return new InstagramAdapter();
  }
}

/**
 * Canonical entry point to normalize raw Apify items based on the source platform.
 */
export function normalizePlatformDataset(platform: PlatformType, rawData: unknown[]): AdapterResult {
  switch (platform) {
    case "facebook":
      return normalizeFacebookDataset(rawData);
    case "x":
      return normalizeTwitterDataset(rawData);
    case "instagram":
    default:
      return normalizeApifyInstagramDataset(rawData);
  }
}
