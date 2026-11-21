import { z } from "zod";
import type { NormalizedPostItem, NormalizedAccountItem } from "../../../types/database.ts";
import type { IPlatformAdapter, AdapterResult } from "../platform-adapter.ts";

/**
 * Extracts a clean Facebook handle or username from profile URLs or handle strings.
 * e.g., "https://www.facebook.com/volunteer.rahul/" -> "volunteer.rahul"
 */
export function extractFacebookHandle(urlOrHandle: string): string {
  const trimmed = urlOrHandle.trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!trimmed.includes("/")) {
    return trimmed.toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.split("/").filter(Boolean);
    // Ignore common prefix paths like /profile.php or /pages/
    if (parts.length > 0) {
      if (parts[0] === "profile.php") {
        const idParam = parsed.searchParams.get("id");
        return (idParam ?? parts[0]).toLowerCase();
      }
      return parts[parts.length - 1].toLowerCase();
    }
  } catch {
    // If not a valid URL, split by slashes
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1].toLowerCase();
    }
  }
  return trimmed.toLowerCase();
}

/**
 * Builds standard Facebook profile URL from a handle.
 */
export function buildFacebookProfileUrl(handle: string): string {
  const clean = handle.trim().replace(/^@/, "");
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean.endsWith("/") ? clean : `${clean}/`;
  }
  return `https://www.facebook.com/${clean}/`;
}

/**
 * Zod schema for Facebook Post Scraper item (AtBpiepuIUNs2k2ku / CaeV1AcRJULMI4vJ3).
 */
export const rawFacebookItemSchema = z.object({
  id: z.union([z.string(), z.number()]).optional().nullable(),
  postId: z.union([z.string(), z.number()]).optional().nullable(),
  url: z.string().optional().nullable(),
  postUrl: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  createdAt: z.union([z.string(), z.number()]).optional().nullable(),
  createdAtUnix: z.number().optional().nullable(),
  reactionCount: z.number().int().optional().nullable(),
  commentCount: z.number().int().optional().nullable(),
  shareCount: z.number().int().optional().nullable(),
  user: z.object({
    id: z.union([z.string(), z.number()]).optional().nullable(),
    name: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
  }).optional().nullable(),
  author: z.object({
    id: z.union([z.string(), z.number()]).optional().nullable(),
    name: z.string().optional().nullable(),
    url: z.string().optional().nullable(),
  }).optional().nullable(),
  attachments: z.array(z.record(z.unknown())).optional().nullable(),
}).passthrough();

export type RawFacebookItem = z.infer<typeof rawFacebookItemSchema>;

/**
 * Normalizes raw Apify Facebook dataset output into canonical domain models.
 */
export function normalizeFacebookDataset(rawData: unknown[]): AdapterResult {
  const normalizedPosts: NormalizedPostItem[] = [];
  const accountsMap = new Map<string, NormalizedAccountItem>();

  for (const item of rawData) {
    const parsed = rawFacebookItemSchema.safeParse(item);
    if (!parsed.success) {
      console.warn("Skipping invalid Facebook scraper item:", parsed.error.format());
      continue;
    }

    const data = parsed.data;

    // Resolve post ID
    const rawId = data.postId ?? data.id;
    if (!rawId) {
      console.warn("Skipping Facebook item with missing post ID:", item);
      continue;
    }
    const platformPostId = String(rawId);

    // Resolve post URL
    const postUrl = data.postUrl ?? data.url;
    if (!postUrl) {
      console.warn("Skipping Facebook item with missing URL:", item);
      continue;
    }

    // Resolve author handle
    const authorObj = data.user ?? data.author;
    const authorUrlOrName = authorObj?.url ?? authorObj?.name ?? "";
    const cleanHandle = extractFacebookHandle(authorUrlOrName || postUrl);

    // Parse timestamp (could be Unix timestamp in seconds, milliseconds, or ISO string)
    let postedAt: string | null = null;
    const rawTime = data.createdAtUnix ?? data.createdAt;
    if (typeof rawTime === "number") {
      // If seconds (10 digits), multiply by 1000
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
      console.warn(`Skipping Facebook item without a valid timestamp: ${postUrl}`);
      continue;
    }

    // Likes / Reactions: preserve null if unmeasured, 0 if genuinely zero
    const likes = typeof data.reactionCount === "number" && data.reactionCount >= 0 ? data.reactionCount : null;
    const comments = typeof data.commentCount === "number" && data.commentCount >= 0 ? data.commentCount : null;
    const shares = typeof data.shareCount === "number" && data.shareCount >= 0 ? data.shareCount : null;
    // Facebook does NOT expose public view count on regular posts
    const views = null;

    // Extract first image thumbnail if present
    let thumbnailUrl: string | null = null;
    if (data.attachments && data.attachments.length > 0) {
      const firstAtt = data.attachments[0];
      if (typeof firstAtt.url === "string") {
        thumbnailUrl = firstAtt.url;
      } else if (typeof firstAtt.thumbnail === "string") {
        thumbnailUrl = firstAtt.thumbnail;
      }
    }

    const postItem: NormalizedPostItem = {
      platform: "facebook",
      account_handle: cleanHandle,
      platform_post_id: platformPostId,
      url: postUrl,
      caption: data.text ?? data.message ?? null,
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

    // Track active account handle
    if (cleanHandle && !accountsMap.has(cleanHandle)) {
      accountsMap.set(cleanHandle, {
        platform: "facebook",
        handle: cleanHandle,
        followers: null,
        following: null,
        post_count: null,
      });
    }
  }

  return { posts: normalizedPosts, accounts: accountsMap };
}

/**
 * Facebook Platform Adapter implementing IPlatformAdapter.
 */
export class FacebookAdapter implements IPlatformAdapter {
  readonly platform = "facebook" as const;

  /**
   * Generates input for Part A discovery using curious_coder/facebook-post-scraper (AtBpiepuIUNs2k2ku).
   */
  buildDiscoveryInput(handles: string[], newerThanDate?: string): Record<string, unknown> {
    const urls = handles.map((h) => buildFacebookProfileUrl(h));
    const input: Record<string, unknown> = {
      urls,
      count: 10,
      sortType: "new_posts",
      outputFormat: "raw",
    };
    if (newerThanDate) {
      input.scrapeUntil = newerThanDate;
    }
    return input;
  }

  /**
   * Generates input for Part B 7-day engagement refresh using CaeV1AcRJULMI4vJ3.
   */
  buildRefreshInput(postUrls: string[]): Record<string, unknown> {
    return {
      postUrls,
      maxPosts: postUrls.length,
    };
  }

  /**
   * Normalizes raw Facebook dataset items.
   */
  normalizeRawItems(items: unknown[]): AdapterResult {
    return normalizeFacebookDataset(items);
  }
}
