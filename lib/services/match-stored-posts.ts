import { createAdminClient } from "../supabase/admin.ts";
import { matchCaption, type MatchableCaption, type MatchableVariant } from "../matching/matcher.ts";
import type { PlatformType, PostMatchStatus } from "../../types/database.ts";

const PAGE_SIZE = 500;

export interface MatchStoredPostsSummary {
  checked: number;
  matched: number;
  needsReview: number;
  unmatched: number;
  errors: string[];
}

interface StoredPostRow {
  id: string;
  account_id: string;
  platform: PlatformType;
  platform_post_id: string;
  url: string;
  caption: string | null;
  posted_at: string;
  thumbnail_url: string | null;
  match_status: PostMatchStatus;
}

interface SnapshotRow {
  snapshot_date: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
}

/** Growth since the previous snapshot. Unmeasured (null) on either side counts as 0 growth. */
function delta(cur: number | null, prev: number | null): number {
  return cur !== null && prev !== null ? Math.max(0, cur - prev) : 0;
}

/**
 * Runs every stored post that is not already 'matched' through the caption matcher and labels it.
 * Nothing is deleted or hidden. Idempotent: running it twice creates no duplicate rows.
 *
 * - exact / approved-variant match -> matched_posts + metric_snapshots (full snapshot history),
 *   posts.match_status = 'matched'
 * - fuzzy match -> review_queue (pending) unless an admin already decided, 'needs_review'
 * - otherwise -> 'unmatched'
 */
export async function matchStoredPosts(): Promise<MatchStoredPostsSummary> {
  const supabase = createAdminClient();
  const summary: MatchStoredPostsSummary = { checked: 0, matched: 0, needsReview: 0, unmatched: 0, errors: [] };

  const { data: captionsRaw, error: capErr } = await supabase
    .from("campaign_captions")
    .select("id, caption_hash, canonical_caption, normalized_caption, released_at")
    .eq("status", "active");
  if (capErr) throw new Error(`Failed to load campaign captions: ${capErr.message}`);
  const captions = (captionsRaw ?? []) as MatchableCaption[];

  const { data: variantsRaw } = await supabase.from("caption_approved_variants").select("caption_id, variant_hash");
  const variants = (variantsRaw ?? []) as MatchableVariant[];

  const { data: reviewsRaw } = await supabase.from("review_queue").select("platform, platform_post_id, status");
  const reviewStatus = new Map<string, string>();
  for (const r of reviewsRaw ?? []) reviewStatus.set(`${r.platform}:${r.platform_post_id}`, r.status as string);

  let lastId: string | null = null;
  // Keyset pagination over posts not yet matched (stable while rows are being updated)
  for (;;) {
    let query = supabase
      .from("posts")
      .select("id, account_id, platform, platform_post_id, url, caption, posted_at, thumbnail_url, match_status")
      .neq("match_status", "matched")
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastId) query = query.gt("id", lastId);
    const { data: page, error } = await query;
    if (error) throw new Error(`Failed to load stored posts: ${error.message}`);
    if (!page || page.length === 0) break;
    lastId = page[page.length - 1].id as string;

    for (const post of page as StoredPostRow[]) {
      summary.checked++;
      try {
        const result = matchCaption(post.caption, captions, variants, {
          postedAt: post.posted_at,
          sameDayOnly: true,
        });
        const key = `${post.platform}:${post.platform_post_id}`;
        let status: PostMatchStatus = "unmatched";
        let captionId: string | null = null;

        if (result.matched && !result.needsReview) {
          status = "matched";
          captionId = result.captionId;
          const nowIso = new Date().toISOString();
          const { data: mp, error: mpErr } = await supabase
            .from("matched_posts")
            .upsert(
              {
                caption_id: result.captionId,
                account_id: post.account_id,
                platform: post.platform,
                platform_post_id: post.platform_post_id,
                post_url: post.url,
                normalized_caption: result.normalizedCaption,
                match_tier: result.tier,
                match_confidence: result.confidence,
                tracking_status: "tracking",
                posted_at: post.posted_at,
                last_seen_at: nowIso,
                last_metrics_refresh_at: nowIso,
                thumbnail_url: post.thumbnail_url,
              },
              { onConflict: "platform,platform_post_id" }
            )
            .select("id")
            .single();
          if (mpErr || !mp) throw new Error(mpErr?.message ?? "no matched_posts row returned");

          // Carry the whole engagement history over so the matrix shows it over time
          const { data: snaps } = await supabase
            .from("post_snapshots")
            .select("snapshot_date, likes, comments, shares, views")
            .eq("post_id", post.id)
            .order("snapshot_date", { ascending: true });
          let prev: SnapshotRow | null = null;
          const rows = ((snaps ?? []) as SnapshotRow[]).map((s) => {
            const row = {
              post_id: mp.id as string,
              snapshot_date: s.snapshot_date,
              likes: s.likes,
              comments: s.comments,
              shares: s.shares,
              views: s.views,
              delta_likes: delta(s.likes, prev?.likes ?? null),
              delta_comments: delta(s.comments, prev?.comments ?? null),
              delta_views: delta(s.views, prev?.views ?? null),
              delta_shares: delta(s.shares, prev?.shares ?? null),
              source: "daily_batch",
              fetched_at: nowIso,
            };
            prev = s;
            return row;
          });
          if (rows.length > 0) {
            const { error: snapErr } = await supabase
              .from("metric_snapshots")
              .upsert(rows, { onConflict: "post_id,snapshot_date" });
            if (snapErr) throw new Error(snapErr.message);
          }
        } else if (result.matched && result.needsReview) {
          const existing = reviewStatus.get(key);
          if (existing === "rejected") {
            status = "unmatched";
          } else if (existing === "approved") {
            status = "matched";
            captionId = result.captionId;
          } else {
            status = "needs_review";
            captionId = result.captionId;
            const { error: qErr } = await supabase.from("review_queue").upsert(
              {
                caption_id: result.captionId,
                account_id: post.account_id,
                platform: post.platform,
                platform_post_id: post.platform_post_id,
                post_url: post.url,
                candidate_caption: post.caption ?? "",
                similarity_score: result.confidence,
                status: "pending",
              },
              { onConflict: "platform,platform_post_id" }
            );
            if (qErr) throw new Error(qErr.message);
            reviewStatus.set(key, "pending");
          }
        }

        if (status !== post.match_status) {
          const { error: updErr } = await supabase
            .from("posts")
            .update({ match_status: status, matched_caption_id: captionId })
            .eq("id", post.id);
          if (updErr) throw new Error(updErr.message);
        }

        if (status === "matched") summary.matched++;
        else if (status === "needs_review") summary.needsReview++;
        else summary.unmatched++;
      } catch (err: unknown) {
        summary.errors.push(`${post.platform}:${post.platform_post_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (page.length < PAGE_SIZE) break;
  }

  return summary;
}
