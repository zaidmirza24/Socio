"use server";

import { createServerComponentClient } from "@/lib/supabase/server";

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
  posts: number;
  followers: number;
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
  url: string;
  caption: string | null;
  mediaType: string | null;
  postedAt: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** Caption-match label. Unmatched posts are still listed with their engagement. */
  matchStatus: "unmatched" | "matched" | "needs_review";
}

export interface VolunteerPostDetail {
  id: string;
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

export interface VolunteerProfileData {
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
import { getDateFilterSince, formatDate } from "@/lib/utils";
import { computeDailyGains, computePostGains, sumGain, type DailyPostGain } from "@/lib/metrics/gain";
import { fetchAllPages, loadPostMeta, loadSnapshotsForPeriod, type PostMeta } from "@/lib/supabase/metrics-data";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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
async function loadPostGains(preset: DateRangePreset, platform: PlatformFilter): Promise<PostGainRow[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  const points = await loadSnapshotsForPeriod(supabase, since);
  const gains = computePostGains(points, since);
  const metaById = await loadPostMeta(supabase, Array.from(gains.keys()));

  const rows: PostGainRow[] = [];
  for (const [postId, g] of Array.from(gains.entries())) {
    const meta = metaById.get(postId);
    if (!meta || !platformMatches(meta, platform)) continue;
    rows.push({ meta, likes: g.likes, comments: g.comments, views: g.views });
  }
  return rows;
}

interface DailyGainRow extends DailyPostGain {
  handle: string;
  volunteerKey: string;
  volunteerName: string;
}

/** Gain per post per day, joined with account details (for trend / ranking charts). */
async function loadDailyGains(preset: DateRangePreset, platform: PlatformFilter): Promise<DailyGainRow[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  const points = await loadSnapshotsForPeriod(supabase, since);
  const daily = computeDailyGains(points, since);
  const metaById = await loadPostMeta(supabase, Array.from(new Set(daily.map((d) => d.postId))));

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
}

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

  const byAccount = new Map<string, { posts: number; likes: number; comments: number; views: number }>();
  for (const r of rows) {
    const key = `@${r.meta.handle}`;
    const e = byAccount.get(key) ?? { posts: 0, likes: 0, comments: 0, views: 0 };
    e.posts += 1;
    e.likes += sumGain([r.likes]);
    e.comments += sumGain([r.comments]);
    e.views += sumGain([r.views]);
    byAccount.set(key, e);
  }

  return Array.from(byAccount.entries())
    .map(([account, v]) => ({ account, ...v }))
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
  const supabase = createServerComponentClient();
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

  for (const r of rows) {
    const key = r.meta.volunteerId ?? `acct:${r.meta.accountId}`;
    const agg = ensure(key, r.meta.volunteerName, r.meta.accountId, r.meta.handle, r.meta.platform);
    const likes = sumGain([r.likes]);
    const comments = sumGain([r.comments]);
    agg.posts += 1;
    agg.likes += likes;
    agg.comments += comments;
    accountEngagement.set(r.meta.accountId, (accountEngagement.get(r.meta.accountId) ?? 0) + likes + comments);
  }

  let accountsQuery = supabase
    .from("accounts")
    .select("id, handle, volunteer_name, platform, volunteer_id")
    .eq("status", "active");
  if (platform !== "all") accountsQuery = accountsQuery.eq("platform", platform);
  const { data: allAccounts, error: accountsErr } = await accountsQuery.limit(5000);
  if (accountsErr) throw new Error(accountsErr.message);

  for (const acc of allAccounts ?? []) {
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
    const row = rows.find((r) => r.meta.accountId === accountId);
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
      let followers = 0;
      for (const id of Array.from(e.accountIds)) followers += latestFollowers.get(id) ?? 0;
      return {
        handle: e.primaryHandle,
        volunteerName: e.volunteerName,
        platform: e.primaryPlatform,
        platforms: Array.from(e.platforms).sort(),
        accounts: e.accountIds.size,
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
  const supabase = createServerComponentClient();

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
    | { handle: string; volunteer_name: string | null }
    | Array<{ handle: string; volunteer_name: string | null }>
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
  account:accounts ( handle, volunteer_name ),
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
    url: post.url ?? "",
    caption: post.caption,
    mediaType: post.media_type ?? "Post",
    postedAt: post.posted_at ? new Date(post.posted_at).toISOString().replace("T", " ").slice(0, 16) : "",
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
  platform: PlatformFilter = "all"
): Promise<RecentPostItem[]> {
  const page = await getPostsPage({ range: preset, platform, pageSize: limit });
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
  const supabase = createServerComponentClient();
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
      .limit(1000);
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
  query = query.order("posted_at", { ascending: false });

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


/**
 * Detailed profile & all posts for a single volunteer account.
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
  const supabase = createServerComponentClient();
  const cleanHandle = rawHandle.replace(/^@/, "").trim().toLowerCase();
  // Used only for server-side metrics/timeline aggregation, NOT to filter fetched posts
  const since = preset ? getDateFilterSince(preset) : null;

  // 1. Fetch account (using exact .eq matching to prevent wildcard ILIKE collision on underscore handles)
  let query = supabase
    .from("accounts")
    .select("id, handle, volunteer_name, platform, status, added_at")
    .eq("handle", cleanHandle);

  if (platform && platform !== "all") {
    query = query.eq("platform", platform);
  }

  const { data: accounts, error: accErr } = await query;

  if (accErr || !accounts || accounts.length === 0) {
    return null;
  }

  // If multiple platforms share this handle and none specified, select the first match
  const account = accounts[0];

  // 2. Fetch latest account snapshot for follower count
  const { data: latestAccSnap } = await supabase
    .from("account_snapshots")
    .select("followers, following, post_count, snapshot_date")
    .eq("account_id", account.id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  // 3. Fetch ALL posts for this account + their snapshots (no date filter — client handles filtering)
  const postsQuery = supabase
    .from("posts")
    .select(`
      id,
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
    .eq("account_id", account.id);

  const { data: rawPosts, error: postsErr } = await postsQuery.order("posted_at", { ascending: false });

  if (postsErr) throw new Error(postsErr.message);

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

    posts.push({
      id: p.id as string,
      platformPostId: (p.platform_post_id as string) ?? "",
      url: (p.url as string) ?? "",
      caption: p.caption as string | null,
      mediaType: (p.media_type as string | null) ?? "Post",
      postedAt: p.posted_at
        ? new Date(p.posted_at as string).toISOString().replace("T", " ").slice(0, 16)
        : "",
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

  return {
    account: {
      id: account.id as string,
      handle: account.handle as string,
      volunteerName: (account.volunteer_name as string | null) ?? account.handle,
      platform: account.platform as string,
      status: account.status as string,
      followers: latestAccSnap?.followers ?? null,
      following: latestAccSnap?.following ?? null,
      totalPostsOnPlatform: latestAccSnap?.post_count ?? null,
      addedAt: account.added_at as string,
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
