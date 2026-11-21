import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";
import { getDateFilterSince } from "@/lib/utils";

const querySchema = z.object({
  range: z.enum(["today", "7d", "30d", "180d", "all"]).default("30d"),
  platform: z.enum(["instagram", "facebook", "x"]).optional(),
  status: z.enum(["started", "success", "failed", "partial"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * GET /api/runs?range=30d&platform=x&status=failed&limit=100
 * Collection-run audit log, filtered in SQL. Team login required.
 */
export async function GET(request: NextRequest) {
  try {
    const supabaseUser = createServerComponentClient();
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Team login required" }, { status: 401 });
    }

    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }
    const { range, platform, status, limit } = parsed.data;

    const admin = createAdminClient();
    let query = admin.from("collection_runs").select("*");

    const since = getDateFilterSince(range);
    if (since) query = query.gte("started_at", new Date(`${since}T00:00:00+05:30`).toISOString());
    if (platform) query = query.eq("platform", platform);
    if (status) query = query.eq("status", status);

    const { data: runs, error } = await query.order("started_at", { ascending: false }).limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ runs: runs || [] });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to load runs";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
