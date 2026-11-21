import { z } from "zod";
import type { NormalizedPostItem, NormalizedAccountItem } from "../../../types/database.ts";
import type { IPlatformAdapter, AdapterResult } from "../platform-adapter.ts";

/**
 * Extracts a clean Twitter/X handle from profile URLs or handle strings.
 * e.g., "https://x.com/volunteer_anita" -> "volunteer_anita"
 * e.g., "https://twitter.com/@volunteer_anita" -> "volunteer_anita"
 */
export function extractTwitterHandle(urlOrHandle: string): string {
  const trimmed = urlOrHandle.trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!trimmed.includes("/")) {
    return trimmed.toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length > 0) {
      // In URLs like https://x.com/user/status/123, author is parts[0]
      return parts[0].replace(/^@/, "").toLowerCase();
    }
  } catch {
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length > 0) {
      return parts[0].replace(/^@/, "").toLowerCase();
    }
  }
  return trimmed.toLowerCase();
}

/**
 * Builds standard Twitter/X profile URL from a handle.
 */
export function buildTwitterProfileUrl(handle: string): string {
  const clean = handle.trim().replace(/^@/, "");
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean.replace("twitter.com", "x.com");
  }
  return `https://x.com/${clean}`;
}

/**
 * Zod schema for Twitter/X Scraper items (Fo9GoU5wC270BgcBr & 73fHdfmMLDzePgHob).
 */
export const rawTwitterItemSchema = z.object({
  // Error row detection
  error: z.string().optional().nullable(),
  inputUrl: z.string().optional().nullable(),

  // Discovery actor fields (Fo9GoU5wC270BgcBr)
  postId: z.union([z.string(), z.number()]).optional().nullable(),
  postUrl: z.string().optional().nullable(),
  postText: z.string().optional().nullable(),
  timestamp: z.union([z.string(), z.number()]).optional().nullable(),
  favouriteCount: z.number().int().optional().nullable(),
  replyCount: z.number().int().optional().nullable(),
  repostCount: z.number().int().optional().nullable(),
  viewCount: z.number().int().optional().nullable(),
  author: z.object({
    name: z.string().optional().nullable(),
    screenName: z.string().optional().nullable(),
    followersCount: z.number().int().optional().nullable(),
    profileImageUrl: z.string().optional().nullable(),
  }).optional().nullable(),

  // Dedicated Part B Refresh actor fields (73fHdfmMLDzePgHob)
  tweetId: z.union([z.string(), z.number()]).optional().nullable(),
  url: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  createdAt: z.union([z.string(), z.number()]).optional().nullable(),
  likeCount: z.number().int().optional().nullable(),
  authorUsername: z.string().optional().nullable(),

  media: z.array(z.union([z.string(), z.record(z.unknown())])).optional().nullable(),
}).passthrough();

export type RawTwitterItem = z.infer<typeof rawTwitterItemSchema>;

/**
 * Normalizes raw Apify Twitter/X dataset output into canonical domain models.
 */
export function normalizeTwitterDataset(rawData: unknown[]): AdapterResult {
  const normalizedPosts: NormalizedPostItem[] = [];
  const accountsMap = new Map<string, NormalizedAccountItem>();

  for (const item of rawData) {
    const parsed = rawTwitterItemSchema.safeParse(item);
    if (!parsed.success) {
      console.warn("Skipping invalid Twitter/X scraper item:", parsed.error.format());
      continue;
    }

    const data = parsed.data;

    // Filter out error rows (e.g. { inputUrl: "...", error: "PAGE_UNAVAILABLE" })
    if (data.error) {
      console.warn(`Skipping Twitter item with error [${data.error}] for ${data.inputUrl}`);
      continue;
    }

    // Resolve tweet ID
    const rawId = data.postId ?? data.tweetId;
    if (!rawId) {
      continue;
    }
    const platformPostId = String(rawId);

    // Resolve tweet permalink URL
    const postUrl = data.postUrl ?? data.url;
    if (!postUrl) {
      continue;
    }

    // Resolve author handle
    const authorHandle = data.author?.screenName ?? data.authorUsername ?? "";
    const cleanHandle = extractTwitterHandle(authorHandle || postUrl);

    // Parse timestamp (could be Unix ms or ISO string)
    let postedAt: string | null = null;
    const rawTime = data.timestamp ?? data.createdAt;
    if (typeof rawTime === "number") {
      const millis = rawTime < 1e11 ? rawTime * 1000 : rawTime;
      const parsedDate = new Date(millis);
      if (!isNaN(parsedDate.getTime())) postedAt = parsedDate.toISOString();
    } else if (typeof rawTime === "string") {
      const parsedDate = new Date(rawTime);
      if (!isNaN(parsedDate.getTime())) {
        postedAt = parsedDate.toISOString();
      }
    }
    // Never invent a date: a post without a real timestamp cannot be placed in a day window.
    if (!postedAt) {
      console.warn(`Skipping Twitter item without a valid timestamp: ${postUrl}`);
      continue;
    }

    // Resolve metrics:
    // Likes: favouriteCount or likeCount
    const rawLikes = data.favouriteCount ?? data.likeCount;
    const likes = typeof rawLikes === "number" && rawLikes >= 0 ? rawLikes : null;

    // Comments / Replies
    const comments = typeof data.replyCount === "number" && data.replyCount >= 0 ? data.replyCount : null;

    // Shares / Reposts
    const shares = typeof data.repostCount === "number" && data.repostCount >= 0 ? data.repostCount : null;

    // Views: Twitter/X public view count is available for ALL post types on discovery
    const views = typeof data.viewCount === "number" && data.viewCount >= 0 ? data.viewCount : null;

    // Thumbnail / Media extraction
    let thumbnailUrl: string | null = null;
    if (data.media && data.media.length > 0) {
      const firstMedia = data.media[0];
      if (typeof firstMedia === "string") {
        thumbnailUrl = firstMedia;
      } else if (typeof firstMedia === "object" && firstMedia !== null) {
        thumbnailUrl =
          (firstMedia.url as string) ??
          (firstMedia.previewUrl as string) ??
          (firstMedia.mediaUrl as string) ??
          null;
      }
    }

    const postItem: NormalizedPostItem = {
      platform: "x",
      account_handle: cleanHandle,
      platform_post_id: platformPostId,
      url: postUrl,
      caption: data.postText ?? data.text ?? null,
      media_type: thumbnailUrl ? "IMAGE" : "TEXT",
      posted_at: postedAt,
      thumbnail_url: thumbnailUrl,
      metrics: {
        likes,
        comments,
        shares,
        views,
      },
      raw_json: data as Record<string, unknown>,
    };

    normalizedPosts.push(postItem);

    // Track active account handle and stats if available
    if (cleanHandle && !accountsMap.has(cleanHandle)) {
      accountsMap.set(cleanHandle, {
        platform: "x",
        handle: cleanHandle,
        followers: data.author?.followersCount ?? null,
        following: null,
        post_count: null,
      });
    }
  }

  return { posts: normalizedPosts, accounts: accountsMap };
}

/**
 * Twitter/X Platform Adapter implementing IPlatformAdapter.
 */
export class TwitterAdapter implements IPlatformAdapter {
  readonly platform = "x" as const;

  /**
   * Generates input for Part A discovery using scraper_one/x-profile-posts-scraper (Fo9GoU5wC270BgcBr).
   */
  buildDiscoveryInput(handles: string[], _newerThanDate?: string): Record<string, unknown> {
    const profileUrls = handles.map((h) => buildTwitterProfileUrl(h));
    return {
      profileUrls,
      resultsLimit: 10,
      skipPinnedPosts: false,
    };
  }

  /**
   * Generates input for Part B 7-day engagement refresh using 73fHdfmMLDzePgHob.
   */
  buildRefreshInput(postUrls: string[]): Record<string, unknown> {
    return {
      tweets: postUrls,
    };
  }

  /**
   * Normalizes raw Twitter/X dataset items.
   */
  normalizeRawItems(items: unknown[]): AdapterResult {
    return normalizeTwitterDataset(items);
  }
}
