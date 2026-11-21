import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Let the client/CDN cache the count for 60 s; revalidate in background.
// This means tab-focus events within the stale window cost zero DB queries.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    if (error) {
      return NextResponse.json({ count: 0 }, {
        status: 200,
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
      });
    }

    return NextResponse.json(
      { count: count ?? 0 },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }
}

