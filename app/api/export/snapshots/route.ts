import { NextRequest, NextResponse } from "next/server";
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

export async function GET(request: NextRequest) {
  try {
    const authClient = createServerComponentClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Team login required" },
        { status: 401 }
      );
    }

    const supabase = createAdminClient();

    // Query all snapshots joined to matched_posts, accounts, and campaign_captions
    const { data: snapshots, error } = await supabase
      .from("metric_snapshots")
      .select(`
        id,
        snapshot_date,
        likes,
        comments,
        views,
        delta_likes,
        delta_comments,
        delta_views,
        source,
        fetched_at,
        matched_posts!inner (
          id,
          post_url,
          platform_post_id,
          platform,
          posted_at,
          accounts!inner (
            handle,
            volunteer_name
          ),
          campaign_captions!inner (
            title
          )
        )
      `)
      .order("snapshot_date", { ascending: false });

    if (error) {
      console.error("Failed to query snapshots for CSV export:", error);
      return NextResponse.json({ error: "Failed to export snapshots", details: error.message }, { status: 500 });
    }

    const headers = [
      "Volunteer Name",
      "Account Handle",
      "Platform",
      "Campaign Title",
      "Post URL",
      "Snapshot Date",
      "Cumulative Likes",
      "Cumulative Comments",
      "Cumulative Views",
      "Delta Likes",
      "Delta Comments",
      "Delta Views",
      "Source",
      "Fetched At",
    ];

    const rows: string[] = [headers.join(",")];

    for (const s of snapshots || []) {
      const mp = s.matched_posts as any;
      const acc = mp?.accounts;
      const caption = mp?.campaign_captions;

      const row = [
        escapeCSV(acc?.volunteer_name ?? "Unknown"),
        escapeCSV(acc?.handle ? `@${acc.handle}` : ""),
        escapeCSV(mp?.platform ?? "instagram"),
        escapeCSV(caption?.title ?? "Untitled Campaign"),
        escapeCSV(mp?.post_url ?? ""),
        escapeCSV(s.snapshot_date),
        escapeCSV(s.likes),
        escapeCSV(s.comments),
        escapeCSV(s.views !== null ? s.views : "n/a"),
        escapeCSV(s.delta_likes),
        escapeCSV(s.delta_comments),
        escapeCSV(s.delta_views),
        escapeCSV(s.source),
        escapeCSV(s.fetched_at),
      ];

      rows.push(row.join(","));
    }

    const csvContent = rows.join("\r\n");
    const today = formatDate();
    const filename = `socio-snapshots-${today}.csv`;

    return new NextResponse(csvContent, {
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

