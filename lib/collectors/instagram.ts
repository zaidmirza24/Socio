import { z } from "zod";
import type { NormalizedPostItem, NormalizedAccountItem } from "@/types/database";

/**
 * Zod validation schema for raw Apify Instagram Post / Actor output items.
 * Accommodates varying Apify actor output keys gracefully.
 */
export const rawApifyInstagramItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  shortCode: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  url: z.string().url(),
  caption: z.string().optional().nullable(),
  timestamp: z.string().optional().nullable(),
  likesCount: z.number().int().optional().nullable(),
  commentsCount: z.number().int().optional().nullable(),
  videoViewCount: z.number().int().optional().nullable(),
  videoPlayCount: z.number().int().optional().nullable(),
  ownerUsername: z.string().min(1, "Instagram username/handle is required"),
  ownerFullName: z.string().optional().nullable(),
  ownerFollowersCount: z.number().int().optional().nullable(),
  ownerFollowsCount: z.number().int().optional().nullable(),
  ownerPostsCount: z.number().int().optional().nullable(),
}).passthrough();

export type RawApifyInstagramItem = z.infer<typeof rawApifyInstagramItemSchema>;

export interface AdapterResult {
  posts: NormalizedPostItem[];
  accounts: Map<string, NormalizedAccountItem>;
}

/**
 * Normalizes an array of raw Apify Instagram items into typed domain models.
 * Preserves metric integrity by ensuring unmeasured metrics remain null.
 */
export function normalizeInstagramDataset(rawData: unknown[]): AdapterResult {
  const normalizedPosts: NormalizedPostItem[] = [];
  const accountsMap = new Map<string, NormalizedAccountItem>();

  for (const item of rawData) {
    const parsed = rawApifyInstagramItemSchema.safeParse(item);
    if (!parsed.success) {
      console.warn("Skipping invalid Apify Instagram item:", parsed.error.format());
      continue;
    }

    const data = parsed.data;
    const cleanHandle = data.ownerUsername.toLowerCase().trim();

    // Parse timestamp safely, fallback to current time if missing
    let postedAt = new Date().toISOString();
    if (data.timestamp) {
      const parsedDate = new Date(data.timestamp);
      if (!isNaN(parsedDate.getTime())) {
        postedAt = parsedDate.toISOString();
      }
    }

    // Determine views: videoViewCount, videoPlayCount, or null (Instagram photos don't have views)
    const views = data.videoViewCount ?? data.videoPlayCount ?? null;

    // Likes & Comments: preserve null if hidden/unmeasured, 0 only if explicitly zero
    const likes = typeof data.likesCount === "number" ? data.likesCount : null;
    const comments = typeof data.commentsCount === "number" ? data.commentsCount : null;

    // Instagram does not publicly expose post shares via public scrapers -> record as null
    const shares = null;

    const postItem: NormalizedPostItem = {
      platform: "instagram",
      account_handle: cleanHandle,
      platform_post_id: data.id,
      url: data.url,
      caption: data.caption ?? null,
      media_type: data.type ?? "Image",
      posted_at: postedAt,
      metrics: {
        likes,
        comments,
        shares,
        views,
      },
      raw_json: data as Record<string, unknown>,
    };

    normalizedPosts.push(postItem);

    // Track or update account profile snapshot metrics
    if (!accountsMap.has(cleanHandle)) {
      accountsMap.set(cleanHandle, {
        platform: "instagram",
        handle: cleanHandle,
        followers: typeof data.ownerFollowersCount === "number" ? data.ownerFollowersCount : null,
        following: typeof data.ownerFollowsCount === "number" ? data.ownerFollowsCount : null,
        post_count: typeof data.ownerPostsCount === "number" ? data.ownerPostsCount : null,
      });
    }
  }

  return {
    posts: normalizedPosts,
    accounts: accountsMap,
  };
}

