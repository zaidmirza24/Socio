import { getPlatformAdapter } from "./platform-adapter.ts";
import type { PlatformType } from "../../types/database.ts";

/**
 * Actor input for a daily-discovery run. The single source of truth for what a discovery run
 * sends to Apify, used by manual runs (provider) and by Apify Schedules, so the two cannot drift.
 */
export function buildDiscoveryRunInput(
  platform: PlatformType,
  handles: string[],
  options: { postLimit?: number; onlyPostsNewerThan?: string } = {}
): Record<string, unknown> {
  const clean = handles.map((h) => h.replace(/^@/, "").trim().toLowerCase());

  if (platform === "instagram") {
    return {
      username: clean,
      usernames: clean,
      directUrls: clean.map((handle) => `https://www.instagram.com/${handle}/`),
      resultsLimit: options.postLimit || 10,
      resultsType: "posts",
      searchType: "user",
      ...(options.onlyPostsNewerThan ? { onlyPostsNewerThan: options.onlyPostsNewerThan } : {}),
    };
  }

  const base = getPlatformAdapter(platform).buildDiscoveryInput(clean, options.onlyPostsNewerThan);
  return {
    ...base,
    ...(options.postLimit ? { resultsLimit: options.postLimit, count: options.postLimit } : {}),
  };
}
