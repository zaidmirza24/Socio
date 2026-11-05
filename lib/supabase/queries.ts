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
// Helpers
// ─────────────────────────────────────────────────────────────

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
export async function getDailyEngagementTrend(): Promise<TrendDataPoint[]> {
  const supabase = createServerComponentClient();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("post_snapshots")
    .select("snapshot_date, likes, comments")
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true });

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
 * Top 10 posts by total engagement (likes + comments + views) in the last 30 days.
 * Reads from post_snapshots (most recent snapshot per post).
 */
export async function getTopPosts(): Promise<TopPostData[]> {
  const supabase = createServerComponentClient();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Pull snapshots with linked post caption/url for labels
  const { data, error } = await supabase
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
    `)
    .gte("snapshot_date", since)
    .order("likes", { ascending: false })
    .limit(50); // over-fetch; we'll deduplicate and pick top 10

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
 * Total engagement (likes, comments, views) summed per volunteer account.
 */
export async function getVolunteerEngagement(): Promise<VolunteerEngagementData[]> {
  const supabase = createServerComponentClient();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("post_snapshots")
    .select(`
      likes,
      comments,
      views,
      post:posts (
        account:accounts ( handle, volunteer_name )
      )
    `)
    .gte("snapshot_date", since);

  if (error) throw new Error(error.message);

  const byAccount = new Map<string, { likes: number; comments: number; views: number }>();
  for (const row of data ?? []) {
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const acct = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    const volunteer = (acct?.volunteer_name as string | null) ?? (acct?.handle as string) ?? "Unknown";
    const existing = byAccount.get(volunteer) ?? { likes: 0, comments: 0, views: 0 };
    byAccount.set(volunteer, {
      likes: existing.likes + coerce(row.likes as number | null),
      comments: existing.comments + coerce(row.comments as number | null),
      views: existing.views + coerce(row.views as number | null),
    });
  }

  return Array.from(byAccount.entries())
    .map(([volunteer, v]) => ({ volunteer, ...v }))
    .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
    .slice(0, 10);
}

/**
 * Daily ranking of the top‑performing volunteer (by total engagement per day).
 * Returns a simplified single-volunteer ranking series.
 */
export async function getVolunteerRanking(): Promise<VolunteerRankingPoint[]> {
  const supabase = createServerComponentClient();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("post_snapshots")
    .select(`
      snapshot_date,
      likes,
      comments,
      views,
      post:posts (
        account:accounts ( handle )
      )
    `)
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true });

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

  // Pick the first volunteer alphabetically as "our tracked volunteer" – in a real app you'd pass a volunteerId
  const result: VolunteerRankingPoint[] = [];
  for (const [date, volunteers] of byDate.entries()) {
    const sorted = Array.from(volunteers.entries()).sort((a, b) => b[1] - a[1]);
    // Find our volunteer's rank (use handle from first row as reference)
    const topHandle = sorted[0]?.[0];
    if (!topHandle) continue;
    const rank = sorted.findIndex(([h]) => h === topHandle) + 1;
    result.push({ date: fmtDate(date), rank });
  }

  return result;
}

/**
 * Per-account: total posts, likes, comments, views in the last 30 days.
 */
export async function getAccountComparison(): Promise<AccountPerformance[]> {
  const supabase = createServerComponentClient();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("post_snapshots")
    .select(`
      likes,
      comments,
      views,
      post:posts (
        account:accounts ( handle )
      )
    `)
    .gte("snapshot_date", since);

  if (error) throw new Error(error.message);

  const byAccount = new Map<string, { posts: Set<string>; likes: number; comments: number; views: number }>();
  let idx = 0;
  for (const row of data ?? []) {
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const acct = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    const handle = `@${(acct?.handle as string) ?? `acct${idx++}`}`;
    if (!byAccount.has(handle)) byAccount.set(handle, { posts: new Set(), likes: 0, comments: 0, views: 0 });
    const entry = byAccount.get(handle)!;
    entry.posts.add(String(idx));
    entry.likes += coerce(row.likes as number | null);
    entry.comments += coerce(row.comments as number | null);
    entry.views += coerce(row.views as number | null);
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
 * Volunteer Performance Leaderboard.
 *
 * Strategy (all in-app, no RPC needed):
 *   1. Fetch every post_snapshot row joined to its post → account.
 *   2. Aggregate likes, comments, views per account.
 *   3. Fetch the latest account_snapshot per account to get follower count.
 *   4. Merge, rank by (totalLikes + totalComments) desc, return top 30.
 */
export async function getVolunteerLeaderboard(): Promise<LeaderboardEntry[]> {
  const supabase = createServerComponentClient();

  // ── Step 1: aggregate post-level metrics per account ──────────────────────
  const { data: snapRows, error: snapErr } = await supabase
    .from("post_snapshots")
    .select(`
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

  if (snapErr) throw new Error(snapErr.message);

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

  for (const row of snapRows ?? []) {
    const postRow = Array.isArray(row.post) ? row.post[0] : row.post;
    if (!postRow) continue;
    const acctRow = Array.isArray(postRow.account) ? postRow.account[0] : postRow.account;
    if (!acctRow) continue;

    const accountId = acctRow.id as string;
    const handle = (acctRow.handle as string) ?? "unknown";
    const volunteerName = (acctRow.volunteer_name as string | null) ?? handle;
    const postId = postRow.id as string;

    if (!byAccount.has(accountId)) {
      byAccount.set(accountId, {
        accountId,
        handle,
        volunteerName,
        postIds: new Set(),
        likes: 0,
        comments: 0,
        views: 0,
      });
    }
    const entry = byAccount.get(accountId)!;
    entry.postIds.add(postId);
    entry.likes += coerce(row.likes as number | null);
    entry.comments += coerce(row.comments as number | null);
    entry.views += coerce(row.views as number | null);
  }

  // ── Step 2: fetch latest follower count per account ───────────────────────
  // Pull all account_snapshots and keep only the most-recent row per account.
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

  // ── Step 3: build leaderboard ─────────────────────────────────────────────
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
 * Real KPI summary aggregated directly from accounts, posts, and post_snapshots.
 */
export async function getKPISummary(): Promise<KPISummary> {
  const supabase = createServerComponentClient();

  const [
    { count: totalAccounts },
    { count: activeAccounts },
    { count: totalPosts },
    { data: snapshots },
  ] = await Promise.all([
    supabase.from("accounts").select("id", { count: "exact", head: true }),
    supabase.from("accounts").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("posts").select("id", { count: "exact", head: true }),
    supabase
      .from("post_snapshots")
      .select("post_id, snapshot_date, likes, comments, views")
      .order("snapshot_date", { ascending: false }),
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

  return {
    totalAccounts: totalAccounts ?? 0,
    activeAccounts: activeAccounts ?? 0,
    totalPosts: totalPosts ?? 0,
    totalLikes,
    totalComments,
    totalViews,
  };
}

/**
 * Real monitored posts fetched from Supabase, joined with account and latest snapshot.
 */
export async function getRecentMonitoredPosts(limit = 100): Promise<RecentPostItem[]> {
  const supabase = createServerComponentClient();

  const { data, error } = await supabase
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
    `)
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
 */
export async function getVolunteerDetails(rawHandle: string): Promise<VolunteerProfileData | null> {
  const supabase = createServerComponentClient();
  const cleanHandle = rawHandle.replace(/^@/, "").trim().toLowerCase();

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

  // 3. Fetch all posts for this account + their snapshots
  const { data: rawPosts, error: postsErr } = await supabase
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
    .eq("account_id", account.id)
    .order("posted_at", { ascending: false });

  if (postsErr) throw new Error(postsErr.message);

  const posts: VolunteerPostDetail[] = [];
  let totalLikes = 0;
  let totalComments = 0;
  let totalViews = 0;

  // Timeline map by date
  const timelineMap = new Map<string, { likes: number; comments: number }>();

  for (const p of rawPosts ?? []) {
    const snaps = (p.post_snapshots as Array<{
      snapshot_date: string;
      likes: number | null;
      comments: number | null;
      views: number | null;
      shares: number | null;
    }>) ?? [];

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

    // Group engagement by post date for timeline
    const dateKey = p.posted_at ? p.posted_at.slice(0, 10) : "unknown";
    if (dateKey !== "unknown") {
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
