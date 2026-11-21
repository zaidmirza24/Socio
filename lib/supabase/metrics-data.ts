import type { createServerComponentClient } from "@/lib/supabase/server";
import type { SnapshotPoint } from "@/lib/metrics/gain";

type Client = ReturnType<typeof createServerComponentClient>;

// Supabase returns at most 1000 rows per request. Every query that can exceed that MUST page
// through the results, otherwise totals are silently truncated.
const PAGE_SIZE = 1000;
const ID_CHUNK = 100;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Loads every snapshot inside the period (snapshot_date >= since) plus, for those posts, the
 * snapshots before it (the baseline needed to measure gain). `since = null` = all time.
 */
export async function loadSnapshotsForPeriod(
  supabase: Client,
  since: string | null
): Promise<SnapshotPoint[]> {
  const windowRows = await fetchAllPages<SnapshotPoint>(async (from, to) => {
    let q = supabase
      .from("post_snapshots")
      .select("post_id, snapshot_date, likes, comments, views");
    if (since) q = q.gte("snapshot_date", since);
    const res = await q
      .order("snapshot_date", { ascending: true })
      .order("post_id", { ascending: true })
      .range(from, to);
    return { data: res.data as SnapshotPoint[] | null, error: res.error };
  });

  if (!since || windowRows.length === 0) return windowRows;

  const postIds = Array.from(new Set(windowRows.map((r) => r.post_id)));
  const baseline: SnapshotPoint[] = [];
  for (let i = 0; i < postIds.length; i += ID_CHUNK) {
    const chunk = postIds.slice(i, i + ID_CHUNK);
    const rows = await fetchAllPages<SnapshotPoint>(async (from, to) => {
      const res = await supabase
        .from("post_snapshots")
        .select("post_id, snapshot_date, likes, comments, views")
        .in("post_id", chunk)
        .lt("snapshot_date", since)
        .order("snapshot_date", { ascending: true })
        .order("post_id", { ascending: true })
        .range(from, to);
      return { data: res.data as SnapshotPoint[] | null, error: res.error };
    });
    baseline.push(...rows);
  }

  return [...baseline, ...windowRows];
}

export interface PostMeta {
  id: string;
  platformPostId: string;
  caption: string | null;
  accountId: string;
  /** The person who owns the account (null for legacy rows with no volunteer link). */
  volunteerId: string | null;
  handle: string;
  volunteerName: string;
  platform: string;
}

interface AcctRow {
  id: string;
  handle: string;
  volunteer_name: string | null;
  platform: string | null;
  volunteer_id: string | null;
}

interface PostMetaRow {
  id: string;
  platform_post_id: string;
  caption: string | null;
  account:
    | AcctRow
    | AcctRow[]
    | null;
}

/** Post + account details for the given post ids. */
export async function loadPostMeta(
  supabase: Client,
  postIds: string[]
): Promise<Map<string, PostMeta>> {
  const meta = new Map<string, PostMeta>();
  for (let i = 0; i < postIds.length; i += ID_CHUNK) {
    const chunk = postIds.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase
      .from("posts")
      .select("id, platform_post_id, caption, account:accounts ( id, handle, volunteer_name, platform, volunteer_id )")
      .in("id", chunk);
    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as unknown as PostMetaRow[]) {
      const acct = Array.isArray(row.account) ? row.account[0] : row.account;
      if (!acct) continue;
      meta.set(row.id, {
        id: row.id,
        platformPostId: row.platform_post_id,
        caption: row.caption,
        accountId: acct.id,
        volunteerId: acct.volunteer_id ?? null,
        handle: acct.handle,
        volunteerName: acct.volunteer_name ?? acct.handle,
        platform: acct.platform ?? "instagram",
      });
    }
  }
  return meta;
}
