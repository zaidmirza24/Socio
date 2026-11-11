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
  rank: number;
}

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
  handle: string;
  volunteerName: string;
  url: string;
  caption: string | null;
  mediaType: string | null;
  postedAt: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function coerce(v: number | null | undefined): number {
  return v ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

/**
 * Daily engagement trend: sum of likes + comments per snapshot_date.
 * Reads from post_snapshots joined to posts.
 */
export async function getDailyEngagementTrend(preset: DateRangePreset = "today"): Promise<TrendDataPoint[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  let query = supabase
    .from("post_snapshots")
    .select("snapshot_date, likes, comments");

  if (since) {
    query = query.gte("snapshot_date", since);
  }

  const { data, error } = await query.order("snapshot_date", { ascending: true });

  if (error) throw new Error(error.message);

  // Aggregate per day
  const byDay = new Map<string, { likes: number; comments: number }>();
  for (const row of data ?? []) {
    const key = row.snapshot_date as string;
    const existing = byDay.get(key) ?? { likes: 0, comments: 0 };
    byDay.set(key, {
      likes: existing.likes + coerce(row.likes as number | null),
      comments: existing.comments + coerce(row.comments as number | null),
    });
  }

  return Array.from(byDay.entries()).map(([date, v]) => ({
    date: fmtDate(date),
    likes: v.likes,
    comments: v.comments,
  }));
}

/**
 * Top 10 posts by total engagement (likes + comments + views) in the selected time range.
 * Reads from post_snapshots (most recent snapshot per post).
 */
export async function getTopPosts(preset: DateRangePreset = "today"): Promise<TopPostData[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  // Pull snapshots with linked post caption/url for labels
  let query = supabase
    .from("post_snapshots")
    .select(`
      likes,
      comments,
      views,
      post:posts (
        platform_post_id,
        caption,
        account:accounts ( handle )
      )
    `);

  if (since) {
    query = query.gte("snapshot_date", since);
  }

  const { data, error } = await query
    .order("likes", { ascending: false })
    .limit(100); // over-fetch; we'll deduplicate and pick top 10

  if (error) throw new Error(error.message);

  // Deduplicate by platform_post_id – keep highest engagement
  const seen = new Map<string, TopPostData>();
  for (const row of data ?? []) {
    // row.post may be an object due to !inner join; guard carefully
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const postId = postRow.platform_post_id as string;
    const acct = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    const handle = (acct?.handle as string) ?? "unknown";
    const caption = (postRow.caption as string | null) ?? "";
    const title = `@${handle}: ${caption.slice(0, 30)}${caption.length > 30 ? "…" : ""}`;
    const likes = coerce(row.likes as number | null);
    const comments = coerce(row.comments as number | null);
    const views = coerce(row.views as number | null);
    const engagement = likes + comments + views;
    if (!seen.has(postId) || engagement > (seen.get(postId)?.engagement ?? 0)) {
      seen.set(postId, { title, likes, comments, views, engagement });
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 10);
}

/**
 * Total engagement (likes, comments, views) summed per volunteer account in the selected time range.
 */
export async function getVolunteerEngagement(preset: DateRangePreset = "today"): Promise<VolunteerEngagementData[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  let query = supabase
    .from("post_snapshots")
    .select(`
      post_id,
      snapshot_date,
      likes,
      comments,
      views,
      post:posts (
        id,
        account:accounts ( handle, volunteer_name )
      )
    `);

  if (since) {
    query = query.gte("snapshot_date", since);
  }

  const { data, error } = await query.order("snapshot_date", { ascending: false });

  if (error) throw new Error(error.message);

  // 1. Keep only the latest snapshot per post
  const latestByPost = new Map<string, {
    volunteer: string;
    likes: number;
    comments: number;
    views: number;
  }>();

  for (const row of data ?? []) {
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const postId = (row.post_id as string) || (postRow.id as string);
    if (!postId || latestByPost.has(postId)) continue;

    const acct = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    const volunteer = (acct?.volunteer_name as string | null) ?? (acct?.handle as string) ?? "Unknown";

    latestByPost.set(postId, {
      volunteer,
      likes: coerce(row.likes as number | null),
      comments: coerce(row.comments as number | null),
      views: coerce(row.views as number | null),
    });
  }

  // 2. Aggregate latest post metrics by volunteer account
  const byAccount = new Map<string, { likes: number; comments: number; views: number }>();
  for (const item of latestByPost.values()) {
    const existing = byAccount.get(item.volunteer) ?? { likes: 0, comments: 0, views: 0 };
    byAccount.set(item.volunteer, {
      likes: existing.likes + item.likes,
      comments: existing.comments + item.comments,
      views: existing.views + item.views,
    });
  }

  return Array.from(byAccount.entries())
    .map(([volunteer, v]) => ({ volunteer, ...v }))
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, 10);
}

/**
 * Daily ranking of the top‑performing volunteer (by total engagement per day) in the selected time range.
 * Returns a simplified single-volunteer ranking series.
 */
export async function getVolunteerRanking(preset: DateRangePreset = "today"): Promise<VolunteerRankingPoint[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  let query = supabase
    .from("post_snapshots")
    .select(`
      snapshot_date,
      likes,
      comments,
      views,
      post:posts (
        account:accounts ( handle )
      )
    `);

  if (since) {
    query = query.gte("snapshot_date", since);
  }

  const { data, error } = await query.order("snapshot_date", { ascending: true });

  if (error) throw new Error(error.message);

  // Group by date → volunteer → total engagement, then rank
  const byDate = new Map<string, Map<string, number>>();
  for (const row of data ?? []) {
    const date = row.snapshot_date as string;
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const acct = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    const handle = (acct?.handle as string) ?? "Unknown";
    const engagement = coerce(row.likes as number | null) + coerce(row.comments as number | null) + coerce(row.views as number | null);

    if (!byDate.has(date)) byDate.set(date, new Map());
    const dateMap = byDate.get(date)!;
    dateMap.set(handle, (dateMap.get(handle) ?? 0) + engagement);
  }

  // Pick the top volunteer as "our tracked volunteer"
  const result: VolunteerRankingPoint[] = [];
  for (const [date, volunteers] of byDate.entries()) {
    const sorted = Array.from(volunteers.entries()).sort((a, b) => b[1] - a[1]);
    const topHandle = sorted[0]?.[0];
    if (!topHandle) continue;
    const rank = sorted.findIndex(([h]) => h === topHandle) + 1;
    result.push({ date: fmtDate(date), rank });
  }

  return result;
}

/**
 * Per-account: total posts, likes, comments, views in the selected time range.
 */
export async function getAccountComparison(preset: DateRangePreset = "today"): Promise<AccountPerformance[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  let query = supabase
    .from("post_snapshots")
    .select(`
      post_id,
      snapshot_date,
      likes,
      comments,
      views,
      post:posts (
        id,
        account:accounts ( handle )
      )
    `);

  if (since) {
    query = query.gte("snapshot_date", since);
  }

  const { data, error } = await query.order("snapshot_date", { ascending: false });

  if (error) throw new Error(error.message);

  // 1. Keep only the latest snapshot per post
  const latestByPost = new Map<string, {
    handle: string;
    postId: string;
    likes: number;
    comments: number;
    views: number;
  }>();

  for (const row of data ?? []) {
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const postId = (row.post_id as string) || (postRow.id as string);
    if (!postId || latestByPost.has(postId)) continue;

    const acct = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    const handle = `@${(acct?.handle as string) ?? "unknown"}`;

    latestByPost.set(postId, {
      handle,
      postId,
      likes: coerce(row.likes as number | null),
      comments: coerce(row.comments as number | null),
      views: coerce(row.views as number | null),
    });
  }

  // 2. Aggregate post count and latest engagement metrics per handle
  const byAccount = new Map<string, { posts: Set<string>; likes: number; comments: number; views: number }>();
  for (const item of latestByPost.values()) {
    if (!byAccount.has(item.handle)) {
      byAccount.set(item.handle, { posts: new Set(), likes: 0, comments: 0, views: 0 });
    }
    const entry = byAccount.get(item.handle)!;
    entry.posts.add(item.postId);
    entry.likes += item.likes;
    entry.comments += item.comments;
    entry.views += item.views;
  }

  return Array.from(byAccount.entries())
    .map(([account, v]) => ({
      account,
      posts: v.posts.size,
      likes: v.likes,
      comments: v.comments,
      views: v.views,
    }))
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, 8);
}

/**
 * Volunteer Performance Leaderboard for the selected time range.
 */
export async function getVolunteerLeaderboard(preset: DateRangePreset = "today"): Promise<LeaderboardEntry[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  // Step 1: Query snapshots ordered by snapshot_date DESC
  let snapQuery = supabase
    .from("post_snapshots")
    .select(`
      post_id,
      snapshot_date,
      likes,
      comments,
      views,
      post:posts (
        id,
        account:accounts (
          id,
          handle,
          volunteer_name
        )
      )
    `);

  if (since) {
    snapQuery = snapQuery.gte("snapshot_date", since);
  }

  const { data: snapRows, error: snapErr } = await snapQuery.order("snapshot_date", { ascending: false });

  if (snapErr) throw new Error(snapErr.message);

  // 1. Keep only the latest snapshot per post
  const latestByPost = new Map<string, {
    accountId: string;
    handle: string;
    volunteerName: string;
    postId: string;
    likes: number;
    comments: number;
    views: number;
  }>();

  for (const row of snapRows ?? []) {
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const acctRow = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    if (!acctRow) continue;

    const postId = (row.post_id as string) || (postRow.id as string);
    if (!postId || latestByPost.has(postId)) continue;

    const accountId = acctRow.id as string;
    const handle = (acctRow.handle as string) ?? "unknown";
    const volunteerName = (acctRow.volunteer_name as string | null) ?? handle;

    latestByPost.set(postId, {
      accountId,
      handle,
      volunteerName,
      postId,
      likes: coerce(row.likes as number | null),
      comments: coerce(row.comments as number | null),
      views: coerce(row.views as number | null),
    });
  }

  type AggEntry = {
    accountId: string;
    handle: string;
    volunteerName: string;
    postIds: Set<string>;
    likes: number;
    comments: number;
    views: number;
  };

  const byAccount = new Map<string, AggEntry>();

  for (const item of latestByPost.values()) {
    if (!byAccount.has(item.accountId)) {
      byAccount.set(item.accountId, {
        accountId: item.accountId,
        handle: item.handle,
        volunteerName: item.volunteerName,
        postIds: new Set(),
        likes: 0,
        comments: 0,
        views: 0,
      });
    }
    const entry = byAccount.get(item.accountId)!;
    entry.postIds.add(item.postId);
    entry.likes += item.likes;
    entry.comments += item.comments;
    entry.views += item.views;
  }

  // Also include active accounts with 0 engagement in this window
  const { data: allAccounts } = await supabase
    .from("accounts")
    .select("id, handle, volunteer_name")
    .eq("status", "active");

  for (const acc of allAccounts ?? []) {
    if (!byAccount.has(acc.id)) {
      byAccount.set(acc.id, {
        accountId: acc.id,
        handle: acc.handle,
        volunteerName: acc.volunteer_name ?? acc.handle,
        postIds: new Set(),
        likes: 0,
        comments: 0,
        views: 0,
      });
    }
  }

  // Step 2: fetch latest follower count per account
  const { data: acctSnaps, error: acctErr } = await supabase
    .from("account_snapshots")
    .select("account_id, snapshot_date, followers")
    .order("snapshot_date", { ascending: false });

  if (acctErr) throw new Error(acctErr.message);

  const latestFollowers = new Map<string, number>();
  for (const row of acctSnaps ?? []) {
    const accId = row.account_id as string;
    if (!latestFollowers.has(accId)) {
      latestFollowers.set(accId, coerce(row.followers as number | null));
    }
  }

  // Step 3: build leaderboard
  const rows = Array.from(byAccount.values())
    .map((e) => ({
      handle: e.handle,
      volunteerName: e.volunteerName,
      posts: e.postIds.size,
      followers: latestFollowers.get(e.accountId) ?? 0,
      totalLikes: e.likes,
      totalComments: e.comments,
      totalEngagement: e.likes + e.comments,
    }))
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, 30)
    .map((e, i) => ({ rank: i + 1, ...e }));

  return rows;
}

/**
 * Real KPI summary aggregated directly from accounts, posts, and post_snapshots for the selected timeframe.
 */
export async function getKPISummary(preset: DateRangePreset = "today"): Promise<KPISummary> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  let snapQuery = supabase
    .from("post_snapshots")
    .select("post_id, snapshot_date, likes, comments, views");

  if (since) {
    snapQuery = snapQuery.gte("snapshot_date", since);
  }

  const [
    { count: totalAccounts },
    { count: activeAccounts },
    { count: totalPosts },
    { data: snapshots },
  ] = await Promise.all([
    supabase.from("accounts").select("id", { count: "exact", head: true }),
    supabase.from("accounts").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("posts").select("id", { count: "exact", head: true }),
    snapQuery.order("snapshot_date", { ascending: false }),
  ]);

  const latestByPost = new Map<string, { likes: number | null; comments: number | null; views: number | null }>();
  for (const s of snapshots ?? []) {
    const postId = s.post_id as string;
    if (!latestByPost.has(postId)) {
      latestByPost.set(postId, {
        likes: s.likes as number | null,
        comments: s.comments as number | null,
        views: s.views as number | null,
      });
    }
  }

  let totalLikes = 0;
  let totalComments = 0;
  let totalViews = 0;
  for (const s of latestByPost.values()) {
    totalLikes += coerce(s.likes);
    totalComments += coerce(s.comments);
    totalViews += coerce(s.views);
  }

  const activePeriodPosts = latestByPost.size;

  return {
    totalAccounts: totalAccounts ?? 0,
    activeAccounts: activeAccounts ?? 0,
    totalPosts: preset === "all" ? (totalPosts ?? 0) : activePeriodPosts > 0 ? activePeriodPosts : (totalPosts ?? 0),
    totalLikes,
    totalComments,
    totalViews,
  };
}

/**
 * Real monitored posts fetched from Supabase, joined with account and latest snapshot.
 */
export async function getRecentMonitoredPosts(
  limit = 100,
  preset: DateRangePreset = "today"
): Promise<RecentPostItem[]> {
  const supabase = createServerComponentClient();
  const since = getDateFilterSince(preset);

  let query = supabase
    .from("posts")
    .select(`
      id,
      platform,
      platform_post_id,
      url,
      caption,
      media_type,
      posted_at,
      account:accounts (
        handle,
        volunteer_name
      ),
      post_snapshots (
        snapshot_date,
        likes,
        comments,
        views
      )
    `);

  if (since) {
    const startOfPeriodIso = new Date(`${since}T00:00:00+05:30`).toISOString();
    query = query.gte("posted_at", startOfPeriodIso);
  }

  const { data, error } = await query
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? []).map((post) => {
    const acct = Array.isArray(post.account) ? post.account[0] : post.account;
    const handle = (acct?.handle as string) ?? "unknown";
    const volunteerName = (acct?.volunteer_name as string | null) ?? handle;

    // Latest snapshot
    const snaps = (post.post_snapshots as Array<{
      snapshot_date: string;
      likes: number | null;
      comments: number | null;
      views: number | null;
    }>) ?? [];
    snaps.sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
    const latest = snaps[0];

    return {
      id: post.id as string,
      handle,
      volunteerName,
      url: post.url as string,
      caption: post.caption as string | null,
      mediaType: (post.media_type as string | null) ?? "Post",
      postedAt: post.posted_at
        ? new Date(post.posted_at as string).toISOString().replace("T", " ").slice(0, 16)
        : "",
      likes: latest?.likes ?? null,
      comments: latest?.comments ?? null,
      views: latest?.views ?? null,
    };
  });
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
  preset?: DateRangePreset
): Promise<VolunteerProfileData | null> {
  const supabase = createServerComponentClient();
  const cleanHandle = rawHandle.replace(/^@/, "").trim().toLowerCase();
  // Used only for server-side metrics/timeline aggregation, NOT to filter fetched posts
  const since = preset ? getDateFilterSince(preset) : null;

  // 1. Fetch account
  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .select("id, handle, volunteer_name, platform, status, added_at")
    .ilike("handle", cleanHandle)
    .single();

  if (accErr || !account) {
    return null;
  }

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
        shares
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
