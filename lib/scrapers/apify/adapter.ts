import { z } from "zod";
import type { NormalizedPostItem, NormalizedAccountItem } from "../../../types/database.ts";

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
  displayUrl: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
  images: z.array(z.string()).optional().nullable(),
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
 * Normalizes an array of raw Apify Instagram items into canonical domain models.
 * Preserves metric integrity by ensuring unmeasured metrics remain null.
 */
export function normalizeApifyInstagramDataset(rawData: unknown[]): AdapterResult {
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

    // The real post date is required: same-day caption matching and the 30-day window depend on it.
    // Never guess "now" - skip the item instead of saving a wrong date.
    const parsedDate = data.timestamp ? new Date(data.timestamp) : null;
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      console.warn(`Skipping Instagram post ${data.id}: missing or invalid timestamp`);
      continue;
    }
    const postedAt = parsedDate.toISOString();

    // Determine views: videoViewCount, videoPlayCount, or null (Instagram photos don't have views)
    const views = data.videoViewCount ?? data.videoPlayCount ?? null;

    // Likes & Comments: preserve null if hidden/unmeasured (-1 in Apify or null/undefined), 0 only if explicitly zero
    const likes = typeof data.likesCount === "number" && data.likesCount >= 0 ? data.likesCount : null;
    const comments = typeof data.commentsCount === "number" && data.commentsCount >= 0 ? data.commentsCount : null;

    // Instagram does not publicly expose post shares via public scrapers -> record as null
    const shares = null;

    // Thumbnail / Display image URL
    const thumbnailUrl = data.displayUrl ?? data.thumbnailUrl ?? (data.images && data.images.length > 0 ? data.images[0] : null);

    const postItem: NormalizedPostItem = {
      platform: "instagram",
      account_handle: cleanHandle,
      platform_post_id: data.id,
      url: data.url,
      caption: data.caption ?? null,
      media_type: data.type ?? "Image",
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
