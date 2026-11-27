"use server";

import { createServerComponentClient } from "@/lib/supabase/server";
import type { PostMatchStatus } from "@/types/database";

// ─────────────────────────────────────────────────────────────
// Return types (match the chart component interfaces exactly)
// ─────────────────────────────────────────────────────────────

export interface TrendDataPoint {
  date: string;
  likes: number;
  comments: number;
}

export interface TopPostData {
  title: string;
  likes: number;
  comments: number;
  views: number;
  engagement: number;
}

export interface VolunteerEngagementData {
  volunteer: string;
  likes: number;
  comments: number;
  views: number;
}

export interface VolunteerRankingPoint {
  date: string;
  /** Best-performing volunteer on this day. */
  volunteer: string;
  /** Likes + comments that volunteer gained on this day (all their accounts). */
  engagement: number;
}

export type PlatformFilter = "all" | "instagram" | "facebook" | "x";

export interface AccountPerformance {
  account: string;
  posts: number;
  likes: number;
  comments: number;
  views: number;
}

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  volunteerName: string;
  /** Primary account's platform (used for the profile link). */
  platform: string;
  /** Every platform this volunteer has an account on. */
  platforms: string[];
  /** Number of accounts (max 3) combined into this row. */
  accounts: number;
  /** The volunteer's id (links to the combined volunteer page); null for legacy unlinked accounts. */
  volunteerId: string | null;
  posts: number;
  /** Sum of the latest measured follower counts; null when none was measured (shown "n/a"). */
  followers: number | null;
  totalLikes: number;
  totalComments: number;
  totalEngagement: number;
}

export interface KPISummary {
  totalAccounts: number;
  activeAccounts: number;
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  totalViews: number;
}

export interface RecentPostItem {
  id: string;
  platform: string;
  handle: string;
  volunteerName: string;
  /** Links to the combined volunteer page; null for legacy unlinked accounts. */
  volunteerId: string | null;
  url: string;
  caption: string | null;
  mediaType: string | null;
  postedAt: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** Caption-match label. Unmatched posts are still listed with their engagement. */
  matchStatus: PostMatchStatus;
}

export interface VolunteerPostDetail {
  id: string;
  /** Platform + handle of the account that published the post (a volunteer page mixes platforms). */
  platform: string;
  handle: string;
  platformPostId: string;
  url: string;
  caption: string | null;
  mediaType: string;
  postedAt: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  shares: number | null;
  quotes: number | null;
  engagement: number;
}

export interface VolunteerAccountSummary {
  id: string;
  handle: string;
  platform: string;
  status: string;
  followers: number | null;
  following: number | null;
  totalPostsOnPlatform: number | null;
}

export interface VolunteerProfileData {
  /**
   * "volunteer" = every account of the volunteer is combined (posts, metrics, timeline);
   * "account" = a single platform account.
   */
  scope: "volunteer" | "account";
  volunteerId: string | null;
  /** All of the volunteer's accounts (max 3), whatever the scope, so the page can link between them. */
  accounts: VolunteerAccountSummary[];
  /**
   * Header details. In "account" scope this is that account. In "volunteer" scope it is the primary
   * account (Instagram first) with `followers` summed over the accounts that reported one.
   */
  account: {
    id: string;
    handle: string;
    volunteerName: string;
    platform: string;
    status: string;
    followers: number | null;
    following: number | null;
    totalPostsOnPlatform: number | null;
    addedAt: string;
  };
  metrics: {
    totalMonitoredPosts: number;
    totalLikes: number;
    totalComments: number;
    totalViews: number;
    avgEngagementPerPost: number;
  };
  timeline: Array<{
    date: string;
    likes: number;
    comments: number;
  }>;
  posts: VolunteerPostDetail[];
}

// ─────────────────────────────────────────────────────────────
// Helpers & Types
// ─────────────────────────────────────────────────────────────

import type { DateRangePreset } from "@/lib/utils";
export type { DateRangePreset };
import { getDateFilterSince, formatDate, formatIstDateTime, formatDayLabel } from "@/lib/utils";
import { computeDailyGains, computePostGains, sumGain, type DailyPostGain } from "@/lib/metrics/gain";
import { fetchAllPages, loadPostMeta, loadSnapshotsForPeriod, type PostMeta } from "@/lib/supabase/metrics-data";
import { cache } from "react";

/**
 * Snapshot history for a period, loaded ONCE per request. The dashboard renders about seven
 * widgets that all need it; React's request-scoped cache() makes them share a single (paged)
 * load instead of re-reading the whole history seven times.
 */
const loadPeriodPoints = cache(async (since: string | null) =>
  loadSnapshotsForPeriod(await createServerComponentClient(), since)
);
/** Post + account details, also shared across widgets in the same request. */
const loadPeriodMeta = cache(async (since: string | null) => {
  const points = await loadPeriodPoints(since);
  return loadPostMeta(await createServerComponentClient(), Array.from(new Set(points.map((p) => p.post_id))));
});

/** "YYYY-MM-DD" day -> "Nov 21" (timezone-proof). */
const fmtDate = formatDayLabel;

function coerce(v: number | null | undefined): number {
  return v ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Queries
//
// All numbers are GAIN OVER THE SELECTED PERIOD (see lib/metrics/gain.ts): the growth in
// likes / comments / views during the period, not lifetime totals. "Engagement" = likes + comments;
// views are reported separately. Snapshots are loaded with paging so nothing is truncated at 1000 rows.
// ─────────────────────────────────────────────────────────────

interface PostGainRow {
  meta: PostMeta;
  likes: number | null;
  comments: number | null;
  views: number | null;
}

function platformMatches(meta: PostMeta, platform: PlatformFilter): boolean {
  return platform === "all" || meta.platform === platform;
}

/** Gain per post in the period, joined with post + account details. */
const loadPostGains = cache(async (preset: DateRangePreset, platform: PlatformFilter): Promise<PostGainRow[]> => {
  const since = getDateFilterSince(preset);

  const points = await loadPeriodPoints(since);
  const gains = computePostGains(points, since);
  const metaById = await loadPeriodMeta(since);

  const rows: PostGainRow[] = [];
  for (const [postId, g] of Array.from(gains.entries())) {
    const meta = metaById.get(postId);
    if (!meta || !platformMatches(meta, platform)) continue;
    rows.push({ meta, likes: g.likes, comments: g.comments, views: g.views });
  }
  return rows;
});

interface DailyGainRow extends DailyPostGain {
  handle: string;
  volunteerKey: string;
  volunteerName: string;
}

/** Gain per post per day, joined with account details (for trend / ranking charts). */
const loadDailyGains = cache(async (preset: DateRangePreset, platform: PlatformFilter): Promise<DailyGainRow[]> => {
  const since = getDateFilterSince(preset);

  const points = await loadPeriodPoints(since);
  const daily = computeDailyGains(points, since);
  const metaById = await loadPeriodMeta(since);

  const rows: DailyGainRow[] = [];
  for (const d of daily) {
    const meta = metaById.get(d.postId);
    if (!meta || !platformMatches(meta, platform)) continue;
    rows.push({
      ...d,
      handle: meta.handle,
      volunteerKey: meta.volunteerId ?? `acct:${meta.accountId}`,
      volunteerName: meta.volunteerName,
    });
  }
  return rows;
});

/**
 * Daily engagement trend: likes and comments GAINED on each day, summed across all posts.
 */
export async function getDailyEngagementTrend(
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all"
): Promise<TrendDataPoint[]> {
  const daily = await loadDailyGains(preset, platform);

  const byDay = new Map<string, { likes: number; comments: number }>();
  for (const row of daily) {
    const existing = byDay.get(row.date) ?? { likes: 0, comments: 0 };
    byDay.set(row.date, {
      likes: existing.likes + sumGain([row.likes]),
      comments: existing.comments + sumGain([row.comments]),
    });
  }

  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date: fmtDate(date), likes: v.likes, comments: v.comments }));
}

/**
 * Top 10 posts by engagement (likes + comments) gained in the selected period.
 */
export async function getTopPosts(
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all"
): Promise<TopPostData[]> {
  const rows = await loadPostGains(preset, platform);

  return rows
    .map((r) => {
      const caption = r.meta.caption ?? "";
      const likes = sumGain([r.likes]);
      const comments = sumGain([r.comments]);
      return {
        title: `@${r.meta.handle}: ${caption.slice(0, 30)}${caption.length > 30 ? "…" : ""}`,
        likes,
        comments,
        views: sumGain([r.views]),
        engagement: likes + comments,
      };
    })
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 10);
}

/**
 * Engagement gained per volunteer (all of their accounts combined) in the selected period (top 10).
 */
export async function getVolunteerEngagement(
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all"
): Promise<VolunteerEngagementData[]> {
  const rows = await loadPostGains(preset, platform);

  const byVolunteer = new Map<string, { volunteer: string; likes: number; comments: number; views: number }>();
  for (const r of rows) {
    const key = r.meta.volunteerId ?? `acct:${r.meta.accountId}`;
    const e = byVolunteer.get(key) ?? { volunteer: r.meta.volunteerName, likes: 0, comments: 0, views: 0 };
    e.likes += sumGain([r.likes]);
    e.comments += sumGain([r.comments]);
    e.views += sumGain([r.views]);
    byVolunteer.set(key, e);
  }

  return Array.from(byVolunteer.values())
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 10);
}

/**
 * The best-performing volunteer on each day of the period, with the engagement they gained that day.
 * (Previously this returned a constant rank of 1, which charted a flat line.)
 */
export async function getVolunteerRanking(
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all"
): Promise<VolunteerRankingPoint[]> {
  const daily = await loadDailyGains(preset, platform);

  // date -> volunteerKey -> { name, engagement }
  const byDate = new Map<string, Map<string, { name: string; engagement: number }>>();
  for (const row of daily) {
    const day = byDate.get(row.date) ?? new Map<string, { name: string; engagement: number }>();
    const cur = day.get(row.volunteerKey) ?? { name: row.volunteerName, engagement: 0 };
    cur.engagement += sumGain([row.likes]) + sumGain([row.comments]);
    day.set(row.volunteerKey, cur);
    byDate.set(row.date, day);
  }

  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, day]) => {
      let best: { name: string; engagement: number } = { name: "-", engagement: 0 };
      for (const v of Array.from(day.values())) {
        if (v.engagement > best.engagement) best = v;
      }
      return { date: fmtDate(date), volunteer: best.name, engagement: best.engagement };
    });
}

/**
 * Per-account: posts and likes/comments/views gained in the selected period (top 8).
 */
export async function getAccountComparison(
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all"
): Promise<AccountPerformance[]> {
  const rows = await loadPostGains(preset, platform);

  // Keyed by platform + handle: the same handle can exist on two platforms and must not be merged.
  const byAccount = new Map<string, { handle: string; platform: string; posts: number; likes: number; comments: number; views: number }>();
  const platformsPerHandle = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.meta.platform}:${r.meta.handle}`;
    const e = byAccount.get(key) ?? { handle: r.meta.handle, platform: r.meta.platform, posts: 0, likes: 0, comments: 0, views: 0 };
    e.posts += 1;
    e.likes += sumGain([r.likes]);
    e.comments += sumGain([r.comments]);
    e.views += sumGain([r.views]);
    byAccount.set(key, e);
    const set = platformsPerHandle.get(r.meta.handle) ?? new Set<string>();
    set.add(r.meta.platform);
    platformsPerHandle.set(r.meta.handle, set);
  }

  return Array.from(byAccount.values())
    .map(({ handle, platform: plat, ...v }) => ({
      // Only add the platform to the label when the bare handle would be ambiguous.
      account: (platformsPerHandle.get(handle)?.size ?? 1) > 1 ? `@${handle} (${plat})` : `@${handle}`,
      ...v,
    }))
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 8);
}

interface LeaderboardAgg {
  key: string;
  volunteerName: string;
  primaryHandle: string;
  primaryPlatform: string;
  primaryEngagement: number;
  accountIds: Set<string>;
  platforms: Set<string>;
  posts: number;
  likes: number;
  comments: number;
}

/**
 * Volunteer leaderboard: one row per VOLUNTEER (their Instagram, Facebook and X accounts combined),
 * ranked by engagement gained in the selected period. Active volunteers with no activity are listed
 * with zero gain. Every volunteer is returned; the UI searches, sorts and pages.
 */
export async function getVolunteerLeaderboard(
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all"
): Promise<LeaderboardEntry[]> {
  const supabase = await createServerComponentClient();
  const rows = await loadPostGains(preset, platform);

  const byVolunteer = new Map<string, LeaderboardAgg>();
  const accountToKey = new Map<string, string>();
  const accountEngagement = new Map<string, number>();

  const ensure = (
    key: string,
    name: string,
    accountId: string,
    handle: string,
    plat: string
  ): LeaderboardAgg => {
    let agg = byVolunteer.get(key);
    if (!agg) {
      agg = {
        key,
        volunteerName: name,
        primaryHandle: handle,
        primaryPlatform: plat,
        primaryEngagement: -1,
        accountIds: new Set<string>(),
        platforms: new Set<string>(),
        posts: 0,
        likes: 0,
        comments: 0,
      };
      byVolunteer.set(key, agg);
    }
    agg.accountIds.add(accountId);
    agg.platforms.add(plat);
    accountToKey.set(accountId, key);
    return agg;
  };

  // First row per account, so the primary-account pass below is a map lookup (not O(n^2)).
  const firstRowByAccount = new Map<string, PostGainRow>();
  for (const r of rows) {
    if (!firstRowByAccount.has(r.meta.accountId)) firstRowByAccount.set(r.meta.accountId, r);
    const key = r.meta.volunteerId ?? `acct:${r.meta.accountId}`;
    const agg = ensure(key, r.meta.volunteerName, r.meta.accountId, r.meta.handle, r.meta.platform);
    const likes = sumGain([r.likes]);
    const comments = sumGain([r.comments]);
    agg.posts += 1;
    agg.likes += likes;
    agg.comments += comments;
    accountEngagement.set(r.meta.accountId, (accountEngagement.get(r.meta.accountId) ?? 0) + likes + comments);
  }

  // Paged: `.limit(5000)` is still capped at 1000 rows by the API, which dropped volunteers.
  const allAccounts = await fetchAllPages<{
    id: string;
    handle: string;
    volunteer_name: string | null;
    platform: string | null;
    volunteer_id: string | null;
  }>(async (from, to) => {
    let q = supabase
      .from("accounts")
      .select("id, handle, volunteer_name, platform, volunteer_id")
      .eq("status", "active");
    if (platform !== "all") q = q.eq("platform", platform);
    const res = await q.order("id").range(from, to);
    return {
      data: res.data as Array<{ id: string; handle: string; volunteer_name: string | null; platform: string | null; volunteer_id: string | null }> | null,
      error: res.error,
    };
  });

  for (const acc of allAccounts) {
    const key = (acc.volunteer_id as string | null) ?? `acct:${acc.id as string}`;
    ensure(
      key,
      (acc.volunteer_name as string | null) ?? (acc.handle as string),
      acc.id as string,
      acc.handle as string,
      (acc.platform as string | null) ?? "instagram"
    );
  }

  // Primary account (used for the profile link) = the volunteer's account with the most engagement.
  for (const [accountId, engagement] of Array.from(accountEngagement.entries())) {
    const agg = byVolunteer.get(accountToKey.get(accountId) ?? "");
    if (!agg || engagement <= agg.primaryEngagement) continue;
    const row = firstRowByAccount.get(accountId);
    if (row) {
      agg.primaryEngagement = engagement;
      agg.primaryHandle = row.meta.handle;
      agg.primaryPlatform = row.meta.platform;
    }
  }

  // Latest follower count per account over the last 14 days. Paged: 600 volunteers x 3 accounts x
  // 14 days is far above the 1000-row API limit, so an unpaged query silently drops accounts.
  const recentSince = formatDate(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
  const acctSnaps = await fetchAllPages<{ account_id: string; snapshot_date: string; followers: number | null }>(
    async (from, to) => {
      const res = await supabase
        .from("account_snapshots")
        .select("account_id, snapshot_date, followers")
        .gte("snapshot_date", recentSince)
        .order("snapshot_date", { ascending: false })
        .order("account_id", { ascending: true })
        .range(from, to);
      return { data: res.data as Array<{ account_id: string; snapshot_date: string; followers: number | null }> | null, error: res.error };
    }
  );

  const latestFollowers = new Map<string, number>();
  for (const row of acctSnaps) {
    if (!latestFollowers.has(row.account_id) && row.followers !== null) {
      latestFollowers.set(row.account_id, row.followers);
    }
  }

  return Array.from(byVolunteer.values())
    .map((e) => {
      let followers: number | null = null;
      for (const id of Array.from(e.accountIds)) {
        const f = latestFollowers.get(id);
        if (f !== undefined) followers = (followers ?? 0) + f;
      }
      return {
        handle: e.primaryHandle,
        volunteerName: e.volunteerName,
        platform: e.primaryPlatform,
        platforms: Array.from(e.platforms).sort(),
        accounts: e.accountIds.size,
        volunteerId: e.key.startsWith("acct:") ? null : e.key,
        posts: e.posts,
        followers,
        totalLikes: e.likes,
        totalComments: e.comments,
        totalEngagement: e.likes + e.comments,
      };
    })
    .sort((a, b) => b.totalEngagement - a.totalEngagement || a.volunteerName.localeCompare(b.volunteerName))
    .map((e, i) => ({ rank: i + 1, ...e }));
}

/**
 * KPI summary for the selected period: likes / comments / views GAINED, plus the number of
 * posts that had activity in the period.
 */
export async function getKPISummary(
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all"
): Promise<KPISummary> {
  const supabase = await createServerComponentClient();

  let totalAccountsQ = supabase.from("accounts").select("id", { count: "exact", head: true });
  let activeAccountsQ = supabase.from("accounts").select("id", { count: "exact", head: true }).eq("status", "active");
  let totalPostsQ = supabase.from("posts").select("id", { count: "exact", head: true });
  if (platform !== "all") {
    totalAccountsQ = totalAccountsQ.eq("platform", platform);
    activeAccountsQ = activeAccountsQ.eq("platform", platform);
    totalPostsQ = totalPostsQ.eq("platform", platform);
  }

  const [{ count: totalAccounts }, { count: activeAccounts }, { count: totalPosts }, rows] = await Promise.all([
    totalAccountsQ,
    activeAccountsQ,
    totalPostsQ,
    loadPostGains(preset, platform),
  ]);

  return {
    totalAccounts: totalAccounts ?? 0,
    activeAccounts: activeAccounts ?? 0,
    totalPosts: preset === "all" ? (totalPosts ?? 0) : rows.length,
    totalLikes: sumGain(rows.map((r) => r.likes)),
    totalComments: sumGain(rows.map((r) => r.comments)),
    totalViews: sumGain(rows.map((r) => r.views)),
  };
}

// ─────────────────────────────────────────────────────────────
// Posts list (latest engagement per post)
// ─────────────────────────────────────────────────────────────

interface PostListRow {
  id: string;
  platform: string | null;
  url: string | null;
  caption: string | null;
  media_type: string | null;
  posted_at: string | null;
  match_status: string | null;
  account:
    | { handle: string; volunteer_name: string | null; volunteer_id: string | null }
    | Array<{ handle: string; volunteer_name: string | null; volunteer_id: string | null }>
    | null;
  post_snapshots: Array<{
    snapshot_date: string;
    likes: number | null;
    comments: number | null;
    views: number | null;
  }> | null;
}

const POST_LIST_SELECT = `
  id,
  platform,
  url,
  caption,
  media_type,
  posted_at,
  match_status,
  account:accounts ( handle, volunteer_name, volunteer_id ),
  post_snapshots ( snapshot_date, likes, comments, views )
`;

function mapPostRow(post: PostListRow): RecentPostItem {
  const acct = Array.isArray(post.account) ? post.account[0] : post.account;
  const handle = acct?.handle ?? "unknown";
  const volunteerName = acct?.volunteer_name ?? handle;

  const snaps = [...(post.post_snapshots ?? [])].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
  const latest = snaps[0];

  return {
    id: post.id,
    platform: post.platform || "instagram",
    handle,
    volunteerName,
    volunteerId: acct?.volunteer_id ?? null,
    url: post.url ?? "",
    caption: post.caption,
    mediaType: post.media_type ?? "Post",
    postedAt: formatIstDateTime(post.posted_at),
    likes: latest?.likes ?? null,
    comments: latest?.comments ?? null,
    views: latest?.views ?? null,
    matchStatus: (post.match_status as RecentPostItem["matchStatus"] | null) ?? "unmatched",
  };
}

/**
 * Recent posts for the dashboard Content tab.
 */
export async function getRecentMonitoredPosts(
  limit = 100,
  preset: DateRangePreset = "today",
  platform: PlatformFilter = "all",
  sort: "recent" | "engagement" = "recent"
): Promise<RecentPostItem[]> {
  const page = await getPostsPage({ range: preset, platform, pageSize: limit, sort });
  return page.posts;
}

export interface PostsPageOptions {
  range: DateRangePreset;
  platform: PlatformFilter;
  view?: "all" | "campaign" | "review";
  search?: string;
  sort?: "recent" | "engagement";
  page?: number;
  pageSize?: number;
}

export interface PostsPageResult {
  posts: RecentPostItem[];
  total: number;
  page: number;
  pageSize: number;
  /** True when "engagement" sorting only covered the newest posts (very large result sets). */
  sortCapped: boolean;
}

const ENGAGEMENT_SORT_CAP = 1000;

/**
 * One page of posts. Platform, view, search and date range are applied in SQL (so counts and pages
 * are correct); only the optional engagement sort happens in memory, over the newest 1,000 matches.
 */
export async function getPostsPage(opts: PostsPageOptions): Promise<PostsPageResult> {
  const supabase = await createServerComponentClient();
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const sort = opts.sort ?? "recent";
  const since = getDateFilterSince(opts.range);

  // Strip characters that have meaning inside a PostgREST filter expression.
  const term = (opts.search ?? "").replace(/[,()*%\\"']/g, " ").trim().slice(0, 80);
  let accountIdFilter = "";
  if (term) {
    const { data: matches, error: matchErr } = await supabase
      .from("accounts")
      .select("id")
      .or(`handle.ilike.%${term}%,volunteer_name.ilike.%${term}%`)
      // Each uuid adds ~37 chars to the request URL; 150 keeps the filter well under URL limits.
      // A term matching more accounts than that is too broad to be useful as an account filter.
      .limit(150);
    if (matchErr) throw new Error(matchErr.message);
    const ids = (matches ?? []).map((m) => m.id as string);
    accountIdFilter = ids.length > 0 ? `,account_id.in.(${ids.join(",")})` : "";
  }

  let query = supabase.from("posts").select(POST_LIST_SELECT, { count: "exact" });
  if (since) query = query.gte("posted_at", new Date(`${since}T00:00:00+05:30`).toISOString());
  if (opts.platform !== "all") query = query.eq("platform", opts.platform);
  if (opts.view === "campaign") query = query.eq("match_status", "matched");
  if (opts.view === "review") query = query.eq("match_status", "needs_review");
  if (term) query = query.or(`caption.ilike.%${term}%${accountIdFilter}`);
  // Only the latest snapshot of each post is needed for the list, not its whole history.
  query = query
    .order("snapshot_date", { referencedTable: "post_snapshots", ascending: false })
    .limit(1, { referencedTable: "post_snapshots" })
    .order("posted_at", { ascending: false });

  if (sort === "engagement") {
    const { data, error, count } = await query.range(0, ENGAGEMENT_SORT_CAP - 1);
    if (error) throw new Error(error.message);
    const all = ((data ?? []) as unknown as PostListRow[]).map(mapPostRow);
    all.sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)));
    const from = (page - 1) * pageSize;
    return {
      posts: all.slice(from, from + pageSize),
      total: count ?? all.length,
      page,
      pageSize,
      sortCapped: (count ?? 0) > ENGAGEMENT_SORT_CAP,
    };
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);
  return {
    posts: ((data ?? []) as unknown as PostListRow[]).map(mapPostRow),
    total: count ?? 0,
    page,
    pageSize,
    sortCapped: false,
  };
}



// ─────────────────────────────────────────────────────────────
// Volunteer / account profile pages
// ─────────────────────────────────────────────────────────────

const PLATFORM_ORDER = ["instagram", "facebook", "x"];

interface ProfileAccountRow {
  id: string;
  handle: string;
  volunteer_name: string | null;
  platform: string | null;
  status: string;
  added_at: string;
  volunteer_id: string | null;
}

const PROFILE_ACCOUNT_COLUMNS = "id, handle, volunteer_name, platform, status, added_at, volunteer_id";

/** Deterministic order: Instagram, Facebook, X. */
function sortByPlatform(rows: ProfileAccountRow[]): ProfileAccountRow[] {
  return [...rows].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platform as string) - PLATFORM_ORDER.indexOf(b.platform as string)
  );
}

/**
 * Builds the profile for `included` accounts (one account, or every account of a volunteer).
 * `allAccounts` is every account of the volunteer, so the page can link between platforms.
 */
async function buildProfile(
  allAccounts: ProfileAccountRow[],
  included: ProfileAccountRow[],
  scope: VolunteerProfileData["scope"],
  volunteerId: string | null,
  preset?: DateRangePreset
): Promise<VolunteerProfileData> {
  const supabase = await createServerComponentClient();
  // Used only for server-side metrics/timeline aggregation, NOT to filter fetched posts
  const since = preset ? getDateFilterSince(preset) : null;

  // 1. Latest account snapshot (followers etc.) per account — at most 3 small queries.
  const accounts: VolunteerAccountSummary[] = await Promise.all(
    allAccounts.map(async (a) => {
      const { data: snap } = await supabase
        .from("account_snapshots")
        .select("followers, following, post_count, snapshot_date")
        .eq("account_id", a.id)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        id: a.id,
        handle: a.handle,
        platform: a.platform ?? "instagram",
        status: a.status,
        followers: snap?.followers ?? null,
        following: snap?.following ?? null,
        totalPostsOnPlatform: snap?.post_count ?? null,
      };
    })
  );

  const includedIds = included.map((a) => a.id);
  const includedSummaries = accounts.filter((a) => includedIds.includes(a.id));
  const accountMeta = new Map(allAccounts.map((a) => [a.id, { handle: a.handle, platform: a.platform ?? "instagram" }]));

  // 2. ALL posts of the included accounts + their snapshots (no date filter — the client handles
  // filtering). Paged: an active account passes 1000 posts over a 5-6 month campaign.
  const rawPosts = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
    const res = await supabase
      .from("posts")
      .select(`
        id,
        account_id,
        platform_post_id,
        url,
        caption,
        media_type,
        posted_at,
        post_snapshots (
          snapshot_date,
          likes,
          comments,
          views,
          shares,
          quotes
        )
      `)
      .in("account_id", includedIds)
      .order("posted_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: res.data as Record<string, unknown>[] | null, error: res.error };
  });

  const posts: VolunteerPostDetail[] = [];
  let totalLikes = 0;
  let totalComments = 0;
  let totalViews = 0;

  // Timeline map by date
  const timelineMap = new Map<string, { likes: number; comments: number }>();

  for (const p of rawPosts ?? []) {
    let snaps = (p.post_snapshots as Array<{
      snapshot_date: string;
      likes: number | null;
      comments: number | null;
      views: number | null;
      shares: number | null;
      quotes: number | null;
    }>) ?? [];

    if (since) {
      snaps = snaps.filter((s) => s.snapshot_date >= since);
    }

    snaps.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
    const latest = snaps[0];

    const likes = latest?.likes ?? null;
    const comments = latest?.comments ?? null;
    const views = latest?.views ?? null;
    const shares = latest?.shares ?? null;
    const quotes = latest?.quotes ?? null;
    const engagement = coerce(likes) + coerce(comments);

    totalLikes += coerce(likes);
    totalComments += coerce(comments);
    totalViews += coerce(views);

    // Group engagement by post date for timeline — convert posted_at (UTC) to IST date
    const dateKey = p.posted_at
      ? formatDate(new Date(p.posted_at as string))
      : "unknown";
    if (dateKey !== "unknown" && (!since || dateKey >= since)) {
      const prev = timelineMap.get(dateKey) ?? { likes: 0, comments: 0 };
      timelineMap.set(dateKey, {
        likes: prev.likes + coerce(likes),
        comments: prev.comments + coerce(comments),
      });
    }

    const meta = accountMeta.get(p.account_id as string);
    posts.push({
      id: p.id as string,
      platform: meta?.platform ?? "instagram",
      handle: meta?.handle ?? "",
      platformPostId: (p.platform_post_id as string) ?? "",
      url: (p.url as string) ?? "",
      caption: p.caption as string | null,
      mediaType: (p.media_type as string | null) ?? "Post",
      postedAt: formatIstDateTime(p.posted_at as string | null),
      likes,
      comments,
      views,
      shares,
      quotes,
      engagement,
    });
  }

  // Sort timeline chronologically
  const timeline = Array.from(timelineMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({
      date: fmtDate(date),
      likes: v.likes,
      comments: v.comments,
    }));

  const totalMonitoredPosts = posts.length;
  const avgEngagementPerPost = totalMonitoredPosts > 0
    ? Math.round((totalLikes + totalComments) / totalMonitoredPosts)
    : 0;

  // Header: the primary included account; followers are summed over the accounts that reported one.
  const primary = included[0];
  const primarySummary = includedSummaries.find((a) => a.id === primary.id) ?? includedSummaries[0];
  const measuredFollowers = includedSummaries.filter((a) => a.followers !== null);
  const followers =
    scope === "volunteer"
      ? measuredFollowers.length > 0
        ? measuredFollowers.reduce((sum, a) => sum + (a.followers ?? 0), 0)
        : null
      : primarySummary?.followers ?? null;

  return {
    scope,
    volunteerId,
    accounts,
    account: {
      id: primary.id,
      handle: primary.handle,
      volunteerName: primary.volunteer_name ?? primary.handle,
      platform: primary.platform ?? "instagram",
      status: scope === "volunteer" && includedSummaries.some((a) => a.status === "active") ? "active" : primary.status,
      followers,
      following: scope === "volunteer" ? null : primarySummary?.following ?? null,
      totalPostsOnPlatform: scope === "volunteer" ? null : primarySummary?.totalPostsOnPlatform ?? null,
      addedAt: primary.added_at,
    },
    metrics: {
      totalMonitoredPosts,
      totalLikes,
      totalComments,
      totalViews,
      avgEngagementPerPost,
    },
    timeline,
    posts,
  };
}

/**
 * Detailed profile & all posts for a single volunteer account (one platform).
 * Always fetches all posts (no date filter at the DB level) so the client
 * can switch date ranges without a server round-trip.
 * The preset parameter only controls how aggregated metrics & the timeline
 * are computed on the server for the initial render.
 */
export async function getVolunteerDetails(
  rawHandle: string,
  preset?: DateRangePreset,
  platform?: string
): Promise<VolunteerProfileData | null> {
  const supabase = await createServerComponentClient();
  const cleanHandle = rawHandle.replace(/^@/, "").trim().toLowerCase();

  // Exact .eq matching prevents wildcard ILIKE collisions on underscore handles.
  let query = supabase.from("accounts").select(PROFILE_ACCOUNT_COLUMNS).eq("handle", cleanHandle);
  if (platform && platform !== "all") {
    query = query.eq("platform", platform);
  }

  const { data, error: accErr } = await query;
  const accounts = (data ?? []) as ProfileAccountRow[];
  if (accErr || accounts.length === 0) {
    return null;
  }

  // If several platforms share this handle and none was specified, pick deterministically
  // (Instagram, then Facebook, then X) instead of whatever order the database returned.
  const account = sortByPlatform(accounts)[0];

  // The volunteer's other accounts, so the page can link to them.
  let siblings: ProfileAccountRow[] = [account];
  if (account.volunteer_id) {
    const { data: rows } = await supabase
      .from("accounts")
      .select(PROFILE_ACCOUNT_COLUMNS)
      .eq("volunteer_id", account.volunteer_id);
    const found = (rows ?? []) as ProfileAccountRow[];
    if (found.some((r) => r.id === account.id)) siblings = sortByPlatform(found);
  }

  return buildProfile(siblings, [account], "account", account.volunteer_id, preset);
}

/**
 * Combined profile for a VOLUNTEER: every account (Instagram, Facebook, X) and all of their posts.
 */
export async function getVolunteerProfile(
  volunteerId: string,
  preset?: DateRangePreset
): Promise<VolunteerProfileData | null> {
  const supabase = await createServerComponentClient();
  const { data, error } = await supabase
    .from("accounts")
    .select(PROFILE_ACCOUNT_COLUMNS)
    .eq("volunteer_id", volunteerId);
  const accounts = (data ?? []) as ProfileAccountRow[];
  if (error || accounts.length === 0) {
    return null;
  }
  const sorted = sortByPlatform(accounts);
  return buildProfile(sorted, sorted, "volunteer", volunteerId, preset);
}
