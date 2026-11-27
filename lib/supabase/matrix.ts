"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkCaller } from "@/lib/supabase/require-admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { getFeatureSettings } from "@/lib/services/settings";
import { formatDate } from "@/lib/utils";
import {
  buildDayRows,
  istDayRange,
  type CoverageAccount,
  type CoverageCaption,
  type CoveragePost,
  type DayVolunteerRow,
} from "@/lib/coverage/day-coverage";
import type { PlatformType } from "@/types/database";

export interface DayCoverageData {
  /** The viewed IST day, YYYY-MM-DD. */
  day: string;
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  /** Every IST day that has at least one active caption, for previous/next navigation. */
  captionDays: string[];
  /** Captions released on `day`, earliest first (Caption 1, 2, ...). */
  captions: CoverageCaption[];
  rows: DayVolunteerRow[];
  /** False when the caption filter is OFF: posts are collected but nothing is matched. */
  matchingEnabled: boolean;
  totalVolunteers: number;
  totalAccounts: number;
}

async function requireTeamMember(): Promise<void> {
  // Server action reading with the service role: verify the caller is a signed-in team member.
  const check = await checkCaller("member");
  if (!check.ok) throw new Error(check.error);
}

interface PostRow {
  id: string;
  account_id: string;
  url: string;
  posted_at: string;
  match_status: string;
  matched_caption_id: string | null;
  match_score: number | null;
  match_best_caption_id: string | null;
}

const POST_COLUMNS = "id, account_id, url, posted_at, match_status, matched_caption_id, match_score, match_best_caption_id";

/**
 * Who posted which of the day's captions, on which platform. Any query failure throws instead of
 * returning partial data: a failed lookup must never show up as "nobody posted".
 */
export async function getDayCoverage(day: string): Promise<DayCoverageData> {
  await requireTeamMember();
  const supabase = createAdminClient();
  const { start, end } = istDayRange(day);

  // 1. Captions released on this IST day (the day's 5-6 captions)
  const { data: captionsRaw, error: captionsError } = await supabase
    .from("campaign_captions")
    .select("id, title, canonical_caption, released_at")
    .eq("status", "active")
    .gte("released_at", start)
    .lt("released_at", end)
    .order("released_at", { ascending: true })
    .order("id", { ascending: true });
  if (captionsError) throw new Error(`Failed to load the day's captions: ${captionsError.message}`);
  const captions: CoverageCaption[] = (captionsRaw ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string,
    canonicalCaption: c.canonical_caption as string,
    releasedAt: c.released_at as string,
  }));
  const captionIds = captions.map((c) => c.id);

  // 2. Days that have captions (previous / next navigation)
  const releaseRows = await fetchAllRows<{ released_at: string }>((from, to) =>
    supabase
      .from("campaign_captions")
      .select("released_at")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to)
  );
  const captionDays = Array.from(new Set(releaseRows.map((r) => formatDate(new Date(r.released_at))))).sort();

  // 3. Active monitored accounts
  const accountsRaw = await fetchAllRows<{
    id: string;
    handle: string;
    volunteer_name: string;
    volunteer_id: string | null;
    platform: PlatformType;
    is_visible: boolean | null;
  }>((from, to) =>
    supabase
      .from("accounts")
      .select("id, handle, volunteer_name, volunteer_id, platform, is_visible")
      .eq("status", "active")
      .order("volunteer_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  const accounts: CoverageAccount[] = accountsRaw.map((a) => ({
    id: a.id,
    handle: a.handle,
    volunteerName: a.volunteer_name,
    volunteerId: a.volunteer_id,
    platform: a.platform,
    isVisible: a.is_visible ?? true,
  }));

  // 4. Posts that matter for this day, and pending reviews for its captions
  const posts: CoveragePost[] = [];
  const reviewIds = new Map<string, string>();
  if (captionIds.length > 0) {
    const [postedThatDay, tiedToCaptions, pendingReviews] = await Promise.all([
      // Everything the accounts posted that day (matched or not): "posted something" vs "nothing"
      fetchAllRows<PostRow>((from, to) =>
        supabase
          .from("posts")
          .select(POST_COLUMNS)
          .gte("posted_at", start)
          .lt("posted_at", end)
          .order("id", { ascending: true })
          .range(from, to)
      ),
      // Posts matched / queued against these captions, even if posted on a neighbouring day
      fetchAllRows<PostRow>((from, to) =>
        supabase
          .from("posts")
          .select(POST_COLUMNS)
          .in("matched_caption_id", captionIds)
          .in("match_status", ["matched", "needs_review"])
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<{ id: string; account_id: string; caption_id: string }>((from, to) =>
        supabase
          .from("review_queue")
          .select("id, account_id, caption_id")
          .eq("status", "pending")
          .in("caption_id", captionIds)
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);

    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const seen = new Set<string>();
    for (const p of [...postedThatDay, ...tiedToCaptions]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const postedMs = new Date(p.posted_at).getTime();
      posts.push({
        accountId: p.account_id,
        url: p.url,
        matchStatus: p.match_status,
        matchedCaptionId: p.matched_caption_id,
        matchScore: typeof p.match_score === "number" ? Number(p.match_score) : null,
        bestCaptionId: p.match_best_caption_id,
        postedOnDay: postedMs >= startMs && postedMs < endMs,
      });
    }
    for (const r of pendingReviews) reviewIds.set(`${r.account_id}:${r.caption_id}`, r.id);
  }

  const { campaign_captions_enabled } = await getFeatureSettings();

  return {
    day,
    today: formatDate(new Date()),
    captionDays,
    captions,
    rows: buildDayRows(accounts, captions, posts, reviewIds),
    matchingEnabled: campaign_captions_enabled,
    // People, not accounts: one volunteer has up to 3 accounts (one per platform).
    totalVolunteers: new Set(accounts.map((a) => a.volunteerId ?? `acct:${a.id}`)).size,
    totalAccounts: accounts.length,
  };
}

export interface AccountDayPost {
  id: string;
  url: string;
  caption: string;
  postedAt: string;
  matchStatus: string;
  /** Why the matcher labelled it so (posts.match_reason), when recorded. */
  matchReason: string | null;
  matchScore: number | null;
  /** The caption it matched, or for an unmatched post the closest one. */
  captionTitle: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
}

/**
 * Detail for the drawer: one account's posts for a day (what it posted that day plus anything
 * matched to that day's captions), with the latest engagement. Loaded on demand so the grid
 * itself needs no per-post metrics.
 */
export async function getAccountDayPosts(accountId: string, day: string): Promise<AccountDayPost[]> {
  await requireTeamMember();
  const supabase = createAdminClient();
  const { start, end } = istDayRange(day);

  const columns = `id, url, caption, posted_at, match_status, match_reason, match_score,
    matched_caption_id, match_best_caption_id`;
  const { data: dayCaptions } = await supabase
    .from("campaign_captions")
    .select("id, title")
    .eq("status", "active")
    .gte("released_at", start)
    .lt("released_at", end);
  const dayCaptionIds = (dayCaptions ?? []).map((c) => c.id as string);

  const [onDay, tied] = await Promise.all([
    supabase.from("posts").select(columns).eq("account_id", accountId).gte("posted_at", start).lt("posted_at", end),
    dayCaptionIds.length > 0
      ? supabase
          .from("posts")
          .select(columns)
          .eq("account_id", accountId)
          .in("matched_caption_id", dayCaptionIds)
          .in("match_status", ["matched", "needs_review"])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (onDay.error) throw new Error(onDay.error.message);
  if (tied.error) throw new Error(tied.error.message);

  interface Row {
    id: string;
    url: string;
    caption: string | null;
    posted_at: string;
    match_status: string;
    match_reason: string | null;
    match_score: number | null;
    matched_caption_id: string | null;
    match_best_caption_id: string | null;
  }
  const byId = new Map<string, Row>();
  for (const r of [...((onDay.data ?? []) as Row[]), ...((tied.data ?? []) as Row[])]) byId.set(r.id, r);
  const posts = Array.from(byId.values()).sort((a, b) => a.posted_at.localeCompare(b.posted_at));
  if (posts.length === 0) return [];

  const titleIds = Array.from(
    new Set(posts.flatMap((p) => [p.matched_caption_id, p.match_best_caption_id]).filter((x): x is string => !!x))
  );
  const titles = new Map<string, string>();
  if (titleIds.length > 0) {
    const { data } = await supabase.from("campaign_captions").select("id, title").in("id", titleIds);
    for (const c of data ?? []) titles.set(c.id as string, c.title as string);
  }

  const { data: snaps } = await supabase
    .from("post_snapshots")
    .select("post_id, snapshot_date, likes, comments, views")
    .in(
      "post_id",
      posts.map((p) => p.id)
    )
    .order("snapshot_date", { ascending: false });
  const latest = new Map<string, { likes: number | null; comments: number | null; views: number | null }>();
  for (const s of snaps ?? []) {
    const id = s.post_id as string;
    if (!latest.has(id)) {
      latest.set(id, {
        likes: (s.likes as number | null) ?? null,
        comments: (s.comments as number | null) ?? null,
        views: (s.views as number | null) ?? null,
      });
    }
  }

  return posts.map((p) => {
    const captionId = p.matched_caption_id ?? p.match_best_caption_id;
    const m = latest.get(p.id);
    return {
      id: p.id,
      url: p.url,
      caption: p.caption ?? "",
      postedAt: p.posted_at,
      matchStatus: p.match_status,
      matchReason: p.match_reason,
      matchScore: typeof p.match_score === "number" ? Number(p.match_score) : null,
      captionTitle: captionId ? titles.get(captionId) ?? null : null,
      // null stays null: hidden / unmeasured is not zero
      likes: m?.likes ?? null,
      comments: m?.comments ?? null,
      views: m?.views ?? null,
    };
  });
}
