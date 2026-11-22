import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/require-admin";

export const dynamic = "force-dynamic";

// Per-user browser cache only: the count is team data, so shared caches (CDN) must not store it.
const CACHE_HEADERS = { "Cache-Control": "private, max-age=30" };

/** GET /api/review-queue/count - number of pending review items, for signed-in team members. */
export async function GET() {
  try {
    // Checked here as well as in middleware, because this reads with the service-role key.
    const guard = await requireUser();
    if (!guard.ok) return guard.response;

    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    if (error) {
      console.error("[review-queue/count]", error.message);
      return NextResponse.json({ count: null }, { status: 200, headers: CACHE_HEADERS });
    }

    return NextResponse.json({ count: count ?? 0 }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ count: null }, { status: 200 });
  }
}
