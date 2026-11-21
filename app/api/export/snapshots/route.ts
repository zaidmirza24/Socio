import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

function escapeCSV(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

interface SnapshotExportRow {
  post_id: string;
  snapshot_date: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  posts: {
    url: string;
    platform: string;
    posted_at: string;
    match_status: string | null;
    accounts: { handle: string; volunteer_name: string } | { handle: string; volunteer_name: string }[] | null;
    campaign_captions: { title: string } | { title: string }[] | null;
  } | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Growth since the previous snapshot of the same post. Unmeasured (null) is shown blank. */
function growth(cur: number | null, prev: number | null | undefined): number | null {
  if (cur === null || prev === null || prev === undefined) return null;
  return Math.max(0, cur - prev);
}

/**
 * CSV of the engagement history of EVERY stored post (matched or not), one row per post per
 * snapshot date. Hidden / unavailable metrics are written as "n/a", never 0.
 */
export async function GET() {
  try {
    const authClient = createServerComponentClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Team login required" }, { status: 401 });
    }

    const supabase = createAdminClient();

    // Paginate: Supabase returns at most 1000 rows per request
    const all: SnapshotExportRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("post_snapshots")
        .select(
          `post_id, snapshot_date, likes, comments, shares, views,
           posts!inner (
             url, platform, posted_at, match_status,
             accounts!inner ( handle, volunteer_name ),
             campaign_captions ( title )
           )`
        )
        .order("post_id", { ascending: true })
        .order("snapshot_date", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error("Failed to query snapshots for CSV export:", error);
        return NextResponse.json({ error: "Failed to export snapshots", details: error.message }, { status: 500 });
      }
      const page = (data ?? []) as unknown as SnapshotExportRow[];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    const headers = [
      "Volunteer Name",
      "Account Handle",
      "Platform",
      "Match Status",
      "Campaign Title",
      "Post URL",
      "Posted At",
      "Snapshot Date",
      "Likes",
      "Comments",
      "Shares",
      "Views",
      "Growth Likes",
      "Growth Comments",
      "Growth Views",
    ];
    const rows: string[] = [headers.join(",")];

    const metric = (v: number | null) => (v === null ? "n/a" : v);
    let prev: SnapshotExportRow | null = null;
    for (const s of all) {
      const sameAsPrev: boolean = prev !== null && prev.post_id === s.post_id;
      const before: SnapshotExportRow | null = sameAsPrev ? prev : null;
      const post = s.posts;
      const acc = one(post?.accounts);
      const caption = one(post?.campaign_captions);

      rows.push(
        [
          escapeCSV(acc?.volunteer_name ?? "Unknown"),
          escapeCSV(acc?.handle ? `@${acc.handle}` : ""),
          escapeCSV(post?.platform ?? ""),
          escapeCSV(post?.match_status ?? "unmatched"),
          escapeCSV(caption?.title ?? ""),
          escapeCSV(post?.url ?? ""),
          escapeCSV(post?.posted_at ?? ""),
          escapeCSV(s.snapshot_date),
          escapeCSV(metric(s.likes)),
          escapeCSV(metric(s.comments)),
          escapeCSV(metric(s.shares)),
          escapeCSV(metric(s.views)),
          escapeCSV(growth(s.likes, before?.likes)),
          escapeCSV(growth(s.comments, before?.comments)),
          escapeCSV(growth(s.views, before?.views)),
        ].join(",")
      );
      prev = s;
    }

    const filename = `socio-engagement-${formatDate()}.csv`;
    return new NextResponse(rows.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("CSV Export Exception:", err);
    return NextResponse.json({ error: "Internal Server Error", details: message }, { status: 500 });
  }
}
