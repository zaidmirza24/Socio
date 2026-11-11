"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";
import { processCaption } from "@/lib/matching/normalizer.ts";
import type { CampaignCaption, CampaignCaptionStatus } from "@/types/database";

async function verifyAdminCaller() {
  const authClient = createServerComponentClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return { authorized: false as const, error: "Authentication required." };
  }

  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { authorized: false as const, error: "Only administrators can perform this action." };
  }

  return { authorized: true as const, user, adminClient };
}

export interface CaptionWithStats extends CampaignCaption {
  matchedPostsCount: number;
  totalLikes: number;
  totalComments: number;
  totalViews: number;
  variantsCount: number;
}

/**
 * Loads all campaign captions along with aggregated post and engagement metrics.
 */
export async function getCampaignCaptions(): Promise<CaptionWithStats[]> {
  const supabase = createAdminClient();

  const { data: captions, error: captionsError } = await supabase
    .from("campaign_captions")
    .select("*")
    .order("created_at", { ascending: false });

  if (captionsError || !captions) {
    console.error("Failed to fetch campaign captions:", captionsError);
    return [];
  }

  // Fetch matched posts with their IDs
  const { data: matchedPosts } = await supabase
    .from("matched_posts")
    .select("id, caption_id");

  // Fetch metric snapshots for those posts ordered by snapshot_date DESC
  const postIds = (matchedPosts || []).map((p) => p.id);
  const { data: snapshots } = postIds.length > 0
    ? await supabase
        .from("metric_snapshots")
        .select("post_id, snapshot_date, likes, comments, views")
        .in("post_id", postIds)
        .order("snapshot_date", { ascending: false })
    : { data: [] };

  // Fetch approved variants count
  const { data: variants } = await supabase
    .from("caption_approved_variants")
    .select("caption_id");

  // Group latest metrics by post_id (first occurrence is the latest snapshot)
  const latestPostMetrics = new Map<string, { likes: number; comments: number; views: number }>();
  for (const s of snapshots || []) {
    if (!latestPostMetrics.has(s.post_id)) {
      latestPostMetrics.set(s.post_id, {
        likes: s.likes ?? 0,
        comments: s.comments ?? 0,
        views: s.views ?? 0,
      });
    }
  }

  // Aggregate by caption_id
  const postsByCaption = new Map<string, number>();
  const metricsByCaption = new Map<string, { likes: number; comments: number; views: number }>();

  for (const p of matchedPosts || []) {
    postsByCaption.set(p.caption_id, (postsByCaption.get(p.caption_id) || 0) + 1);

    const m = latestPostMetrics.get(p.id) || { likes: 0, comments: 0, views: 0 };
    const cm = metricsByCaption.get(p.caption_id) || { likes: 0, comments: 0, views: 0 };
    cm.likes += m.likes;
    cm.comments += m.comments;
    cm.views += m.views;
    metricsByCaption.set(p.caption_id, cm);
  }

  const variantsByCaption = new Map<string, number>();
  for (const v of variants || []) {
    variantsByCaption.set(v.caption_id, (variantsByCaption.get(v.caption_id) || 0) + 1);
  }

  return captions.map((c) => {
    const cm = metricsByCaption.get(c.id) || { likes: 0, comments: 0, views: 0 };
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
      error: `Database error: ${insertError.message}`,
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

  if (!items || items.length === 0) {
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
      error: `Database check error: ${checkError.message}`,
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
      error: `Database insert error: ${insertError.message}`,
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

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("campaign_captions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard/captions");
  revalidatePath("/dashboard");

  return { success: true };
}

