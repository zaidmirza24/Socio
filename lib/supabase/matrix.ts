"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export type MatrixCellStatus = "POSTED" | "PENDING" | "NEEDS_REVIEW" | "NOT_VISIBLE";

export interface MatrixPostItem {
  id: string;
  url: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  postedAt: string;
}

export interface MatrixCell {
  status: MatrixCellStatus;
  post?: MatrixPostItem;
  posts?: MatrixPostItem[];
  reviewQueueId?: string;
  similarityScore?: number;
}

export interface MatrixAccount {
  id: string;
  handle: string;
  volunteerName: string;
  platform: string;
  isVisible: boolean;
  lastCheckedAt: string | null;
}

export interface MatrixRow {
  account: MatrixAccount;
  cells: Record<string, MatrixCell>; // captionId -> MatrixCell
}

export interface MatrixData {
  captions: Array<{
    id: string;
    title: string;
    canonicalCaption: string;
    releasedAt: string;
  }>;
  rows: MatrixRow[];
  stats: {
    totalVolunteers: number;
    activeCaptionsCount: number;
    totalPosted: number;
    totalPending: number;
    totalNeedsReview: number;
    totalNotVisible: number;
    completionRate: number; // percentage (0-100)
  };
}

/**
 * Loads and constructs the full Volunteers x Captions Matrix.
 */
export async function getMatrixData(): Promise<MatrixData> {
  const supabase = createAdminClient();

  // 1. Fetch active campaign captions
  const { data: captionsRaw, error: captionsError } = await supabase
    .from("campaign_captions")
    .select("id, title, canonical_caption, released_at")
    .eq("status", "active")
    .order("released_at", { ascending: false });

  if (captionsError) {
    console.error("Failed to query active captions:", captionsError);
  }

  const captions = (captionsRaw || []).map((c) => ({
    id: c.id,
    title: c.title,
    canonicalCaption: c.canonical_caption,
    releasedAt: c.released_at,
  }));

  // 2. Fetch active monitored accounts
  const { data: accountsRaw, error: accountsError } = await supabase
    .from("accounts")
    .select("id, handle, volunteer_name, platform, is_visible, last_checked_at")
    .eq("status", "active")
    .order("volunteer_name", { ascending: true });

  if (accountsError) {
    console.error("Failed to query accounts:", accountsError);
  }

  const accounts: MatrixAccount[] = (accountsRaw || []).map((a) => ({
    id: a.id,
    handle: a.handle,
    volunteerName: a.volunteer_name,
    platform: a.platform,
    isVisible: a.is_visible ?? true,
    lastCheckedAt: a.last_checked_at,
  }));

  // 3. Fetch matched posts
  const { data: matchedPostsRaw } = await supabase
    .from("matched_posts")
    .select("id, caption_id, account_id, post_url, posted_at, tracking_status")
    .neq("tracking_status", "archived");

  // Fetch metric snapshots for those posts
  const postIds = (matchedPostsRaw || []).map((p) => p.id);
  const { data: snapshotsRaw } = postIds.length > 0
    ? await supabase
        .from("metric_snapshots")
        .select("post_id, likes, comments, views, snapshot_date")
        .in("post_id", postIds)
        .order("snapshot_date", { ascending: false })
    : { data: [] };

  // Map latest snapshot metrics per post
  const latestMetrics = new Map<string, { likes: number | null; comments: number | null; views: number | null }>();
  for (const s of snapshotsRaw || []) {
    if (!latestMetrics.has(s.post_id)) {
      latestMetrics.set(s.post_id, {
        likes: s.likes,
        comments: s.comments,
        views: s.views,
      });
    }
  }

  // Key by `accountId:captionId`
  const matchedPostsMap = new Map<string, MatrixPostItem[]>();

  for (const mp of matchedPostsRaw || []) {
    const key = `${mp.account_id}:${mp.caption_id}`;
    const metrics = latestMetrics.get(mp.id) || { likes: null, comments: null, views: null };
    const item: MatrixPostItem = {
      id: mp.id,
      url: mp.post_url,
      postedAt: mp.posted_at,
      likes: metrics.likes,
      comments: metrics.comments,
      views: metrics.views,
    };
    const list = matchedPostsMap.get(key) || [];
    list.push(item);
    matchedPostsMap.set(key, list);
  }

  // 4. Fetch pending review queue items
  const { data: reviewQueueRaw } = await supabase
    .from("review_queue")
    .select("id, caption_id, account_id, similarity_score")
    .eq("status", "pending");

  const reviewQueueMap = new Map<string, { id: string; similarityScore: number }>();
  for (const rq of reviewQueueRaw || []) {
    const key = `${rq.account_id}:${rq.caption_id}`;
    reviewQueueMap.set(key, {
      id: rq.id,
      similarityScore: typeof rq.similarity_score === "number" ? rq.similarity_score : 0.9,
    });
  }

  // 5. Construct Rows & Compute Matrix Stats
  let totalPosted = 0;
  let totalPending = 0;
  let totalNeedsReview = 0;
  let totalNotVisible = 0;

  const rows: MatrixRow[] = accounts.map((account) => {
    const cells: Record<string, MatrixCell> = {};

    for (const caption of captions) {
      const key = `${account.id}:${caption.id}`;
      const matchedList = matchedPostsMap.get(key);
      const inReview = reviewQueueMap.get(key);

      if (matchedList && matchedList.length > 0) {
        const totalLikes = matchedList.some((p) => p.likes !== null)
          ? matchedList.reduce((acc, p) => acc + (p.likes ?? 0), 0)
          : null;
        const totalComments = matchedList.some((p) => p.comments !== null)
          ? matchedList.reduce((acc, p) => acc + (p.comments ?? 0), 0)
          : null;
        const totalViews = matchedList.some((p) => p.views !== null)
          ? matchedList.reduce((acc, p) => acc + (p.views ?? 0), 0)
          : null;

        cells[caption.id] = {
          status: "POSTED",
          post: {
            ...matchedList[0],
            likes: totalLikes,
            comments: totalComments,
            views: totalViews,
          },
          posts: matchedList,
        };
        totalPosted++;
      } else if (inReview) {
        cells[caption.id] = {
          status: "NEEDS_REVIEW",
          reviewQueueId: inReview.id,
          similarityScore: inReview.similarityScore,
        };
        totalNeedsReview++;
      } else if (!account.isVisible) {
        cells[caption.id] = {
          status: "NOT_VISIBLE",
        };
        totalNotVisible++;
      } else {
        cells[caption.id] = {
          status: "PENDING",
        };
        totalPending++;
      }
    }

    return {
      account,
      cells,
    };
  });

  const totalPossible = accounts.length * captions.length;
  const completionRate = totalPossible > 0 ? Math.round((totalPosted / totalPossible) * 100) : 0;

  return {
    captions,
    rows,
    stats: {
      totalVolunteers: accounts.length,
      activeCaptionsCount: captions.length,
      totalPosted,
      totalPending,
      totalNeedsReview,
      totalNotVisible,
      completionRate,
    },
  };
}

