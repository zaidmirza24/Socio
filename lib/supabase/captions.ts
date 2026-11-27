"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logInternal } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkCaller, verifyAdminCaller } from "@/lib/supabase/require-admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { processCaption } from "@/lib/matching/normalizer.ts";
import type { CampaignCaption, CampaignCaptionStatus } from "@/types/database";


// Server actions are public POST endpoints: validate their arguments at the boundary.
const optionalDate = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), { message: "Invalid release date." });

const captionInputSchema = z.object({
  title: z.string().max(500, "Title is too long (max 500 characters)."),
  // Generous on purpose: Facebook captions can be very long. This only stops absurd payloads.
  canonicalCaption: z.string().max(70000, "Caption is too long."),
  releasedAt: optionalDate,
});

const bulkCaptionsSchema = z
  .array(captionInputSchema)
  .max(1000, "Maximum 1000 captions per batch.");

const captionStatusSchema = z.object({
  id: z.string().uuid("Invalid caption ID."),
  status: z.enum(["active", "archived"]),
});

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input.";
}

export interface CaptionWithStats extends CampaignCaption {
  matchedPostsCount: number;
  /** null = no matched post has a measured value yet (shown as "n/a"). */
  totalLikes: number | null;
  totalComments: number | null;
  totalViews: number | null;
  variantsCount: number;
}

/**
 * Loads all campaign captions along with aggregated post and engagement metrics.
 */
export async function getCampaignCaptions(): Promise<CaptionWithStats[]> {
  // Server action reading with the service role: verify the caller is a signed-in team member.
  if (!(await checkCaller("member")).ok) return [];

  const supabase = createAdminClient();

  const { data: captions, error: captionsError } = await supabase
    .from("campaign_captions")
    .select("*")
    .order("created_at", { ascending: false });

  if (captionsError || !captions) {
    console.error("Failed to fetch campaign captions:", captionsError);
    return [];
  }

  // Matched posts (paged) and their latest metrics. The latest snapshot per post is computed in
  // SQL (view matched_post_latest_metrics) instead of downloading every snapshot of every post.
  let matchedPosts: { id: string; caption_id: string }[];
  let latestRows: { post_id: string; likes: number | null; comments: number | null; views: number | null }[];
  try {
    [matchedPosts, latestRows] = await Promise.all([
      fetchAllRows<{ id: string; caption_id: string }>((from, to) =>
        supabase.from("matched_posts").select("id, caption_id").order("id").range(from, to)
      ),
      fetchAllRows<{ post_id: string; likes: number | null; comments: number | null; views: number | null }>(
        (from, to) =>
          supabase
            .from("matched_post_latest_metrics")
            .select("post_id, likes, comments, views")
            .order("post_id")
            .range(from, to)
      ),
    ]);
  } catch (statsError: unknown) {
    console.error("Failed to load caption stats:", statsError);
    matchedPosts = [];
    latestRows = [];
  }

  // Fetch approved variants count
  const { data: variants } = await supabase
    .from("caption_approved_variants")
    .select("caption_id");

  const latestPostMetrics = new Map(latestRows.map((r) => [r.post_id, r]));

  // Aggregate by caption_id. Totals stay null until at least one post has a measured value, so
  // the UI shows "n/a" rather than a made-up 0 (e.g. hidden likes, image posts without views).
  type Totals = { likes: number | null; comments: number | null; views: number | null };
  const add = (sum: number | null, v: number | null | undefined) => (typeof v === "number" ? (sum ?? 0) + v : sum);
  const postsByCaption = new Map<string, number>();
  const metricsByCaption = new Map<string, Totals>();

  for (const p of matchedPosts) {
    postsByCaption.set(p.caption_id, (postsByCaption.get(p.caption_id) || 0) + 1);
    const m = latestPostMetrics.get(p.id);
    const cm = metricsByCaption.get(p.caption_id) ?? { likes: null, comments: null, views: null };
    cm.likes = add(cm.likes, m?.likes);
    cm.comments = add(cm.comments, m?.comments);
    cm.views = add(cm.views, m?.views);
    metricsByCaption.set(p.caption_id, cm);
  }

  const variantsByCaption = new Map<string, number>();
  for (const v of variants || []) {
    variantsByCaption.set(v.caption_id, (variantsByCaption.get(v.caption_id) || 0) + 1);
  }

  return captions.map((c) => {
    const cm = metricsByCaption.get(c.id) ?? { likes: null, comments: null, views: null };
    return {
      id: c.id,
      title: c.title,
      canonical_caption: c.canonical_caption,
      normalized_caption: c.normalized_caption,
      caption_hash: c.caption_hash,
      released_at: c.released_at,
      status: c.status as CampaignCaptionStatus,
      created_at: c.created_at,
      updated_at: c.updated_at,
      matchedPostsCount: postsByCaption.get(c.id) || 0,
      totalLikes: cm.likes,
      totalComments: cm.comments,
      totalViews: cm.views,
      variantsCount: variantsByCaption.get(c.id) || 0,
    };
  });
}

/**
 * Creates and registers a new official campaign caption.
 * Automatically normalizes the text and calculates the SHA-256 hash.
 */
export async function createCampaignCaption(input: {
  title: string;
  canonicalCaption: string;
  releasedAt?: string;
}): Promise<{ success: boolean; error?: string; caption?: CampaignCaption }> {
  const auth = await verifyAdminCaller();
  if (!auth.authorized) {
    return { success: false, error: auth.error };
  }

  const parsed = captionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: firstIssue(parsed.error) };
  }
  input = parsed.data;

  const title = input.title.trim();
  const rawCaption = input.canonicalCaption.trim();

  if (!title) {
    return { success: false, error: "Campaign title is required." };
  }
  if (!rawCaption) {
    return { success: false, error: "Canonical caption text cannot be empty." };
  }

  const { normalized, hash } = processCaption(rawCaption);
  const releasedAt = input.releasedAt ? new Date(input.releasedAt).toISOString() : new Date().toISOString();

  const supabase = createAdminClient();

  // Check if identical caption hash already exists
  const { data: existing } = await supabase
    .from("campaign_captions")
    .select("id, title")
    .eq("caption_hash", hash)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `This caption has already been registered under the title "${existing.title}".`,
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("campaign_captions")
    .insert({
      title,
      canonical_caption: rawCaption,
      normalized_caption: normalized,
      caption_hash: hash,
      released_at: releasedAt,
      status: "active",
    })
    .select()
    .single();

  if (insertError) {
    return {
      success: false,
      error: logInternal(insertError, "Could not save the caption. Please try again."),
    };
  }

  revalidatePath("/dashboard/captions");
  revalidatePath("/dashboard");

  return {
    success: true,
    caption: inserted as CampaignCaption,
  };
}

export interface BulkCaptionInputItem {
  title: string;
  canonicalCaption: string;
  releasedAt?: string;
}

export interface BulkCaptionResult {
  success: boolean;
  error?: string;
  totalSubmitted: number;
  insertedCount: number;
  skippedDuplicatesCount: number;
  insertedCaptions: CampaignCaption[];
}

/**
 * Creates and registers multiple official campaign captions in a single atomic batch.
 * - Deduplicates within the incoming batch
 * - Queries existing database hashes in a single query
 * - Skips already-registered captions without failing the whole batch
 * - Performs a single batch insert for all unique valid captions
 */
export async function createCampaignCaptionsBulk(
  items: BulkCaptionInputItem[]
): Promise<BulkCaptionResult> {
  const auth = await verifyAdminCaller();
  if (!auth.authorized) {
    return {
      success: false,
      error: auth.error,
      totalSubmitted: items.length,
      insertedCount: 0,
      skippedDuplicatesCount: 0,
      insertedCaptions: [],
    };
  }

  const parsedItems = bulkCaptionsSchema.safeParse(items);
  if (!parsedItems.success) {
    return {
      success: false,
      error: firstIssue(parsedItems.error),
      totalSubmitted: Array.isArray(items) ? items.length : 0,
      insertedCount: 0,
      skippedDuplicatesCount: 0,
      insertedCaptions: [],
    };
  }
  items = parsedItems.data;

  if (items.length === 0) {
    return {
      success: false,
      error: "No captions provided for bulk registration.",
      totalSubmitted: 0,
      insertedCount: 0,
      skippedDuplicatesCount: 0,
      insertedCaptions: [],
    };
  }

  const supabase = createAdminClient();

  // 1. Process, normalize, and hash all items; deduplicate in-memory within batch
  const processedItems: Array<{
    title: string;
    canonical_caption: string;
    normalized_caption: string;
    caption_hash: string;
    released_at: string;
    status: string;
  }> = [];

  const batchSeenHashes = new Set<string>();
  let internalDuplicateCount = 0;

  for (const item of items) {
    const title = (item.title || "").trim();
    const rawCaption = (item.canonicalCaption || "").trim();

    if (!title || !rawCaption) continue;

    const { normalized, hash } = processCaption(rawCaption);

    if (batchSeenHashes.has(hash)) {
      internalDuplicateCount++;
      continue;
    }
    batchSeenHashes.add(hash);

    const releasedAt = item.releasedAt
      ? new Date(item.releasedAt).toISOString()
      : new Date().toISOString();

    processedItems.push({
      title,
      canonical_caption: rawCaption,
      normalized_caption: normalized,
      caption_hash: hash,
      released_at: releasedAt,
      status: "active",
    });
  }

  if (processedItems.length === 0) {
    return {
      success: false,
      error: "All provided captions were empty or invalid.",
      totalSubmitted: items.length,
      insertedCount: 0,
      skippedDuplicatesCount: internalDuplicateCount,
      insertedCaptions: [],
    };
  }

  // 2. Query existing database hashes in a single operation
  const allHashes = processedItems.map((p) => p.caption_hash);
  const { data: existingRows, error: checkError } = await supabase
    .from("campaign_captions")
    .select("caption_hash")
    .in("caption_hash", allHashes);

  if (checkError) {
    return {
      success: false,
      error: logInternal(checkError, "Could not check existing captions. Please try again."),
      totalSubmitted: items.length,
      insertedCount: 0,
      skippedDuplicatesCount: 0,
      insertedCaptions: [],
    };
  }

  const existingHashSet = new Set((existingRows || []).map((r) => r.caption_hash));
  const newItemsToInsert = processedItems.filter((p) => !existingHashSet.has(p.caption_hash));
  const dbDuplicateCount = processedItems.length - newItemsToInsert.length;
  const totalSkipped = internalDuplicateCount + dbDuplicateCount;

  if (newItemsToInsert.length === 0) {
    return {
      success: true,
      error: "All submitted captions are already registered in the database.",
      totalSubmitted: items.length,
      insertedCount: 0,
      skippedDuplicatesCount: totalSkipped,
      insertedCaptions: [],
    };
  }

  // 3. Perform atomic batch insert
  const { data: insertedRecords, error: insertError } = await supabase
    .from("campaign_captions")
    .insert(newItemsToInsert)
    .select();

  if (insertError) {
    return {
      success: false,
      error: logInternal(insertError, "Could not save the captions. Please try again."),
      totalSubmitted: items.length,
      insertedCount: 0,
      skippedDuplicatesCount: totalSkipped,
      insertedCaptions: [],
    };
  }

  revalidatePath("/dashboard/captions");
  revalidatePath("/dashboard");

  return {
    success: true,
    totalSubmitted: items.length,
    insertedCount: insertedRecords?.length || newItemsToInsert.length,
    skippedDuplicatesCount: totalSkipped,
    insertedCaptions: (insertedRecords as CampaignCaption[]) || [],
  };
}

/**
 * Updates status of a campaign caption (e.g. 'archived' or 'active').
 */
export async function updateCaptionStatus(
  id: string,
  status: CampaignCaptionStatus
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminCaller();
  if (!auth.authorized) {
    return { success: false, error: auth.error };
  }

  const parsed = captionStatusSchema.safeParse({ id, status });
  if (!parsed.success) {
    return { success: false, error: firstIssue(parsed.error) };
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("campaign_captions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { success: false, error: logInternal(error, "Could not update the caption status.") };
  }

  revalidatePath("/dashboard/captions");
  revalidatePath("/dashboard");

  return { success: true };
}

