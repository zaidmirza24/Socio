import { NextRequest, NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";
import { getDateFilterSince } from "@/lib/utils";
import { fetchAllRows } from "@/lib/supabase/paginate";

// Per-user data read with session cookies: never prerender or cache.
export const dynamic = "force-dynamic";

const querySchema = z.object({
  range: z.enum(["today", "7d", "30d", "180d", "all"]).default("30d"),
  platform: z.enum(["instagram", "facebook", "x"]).optional(),
  status: z.enum(["started", "ingesting", "success", "failed", "partial"]).optional(),
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
    const since = getDateFilterSince(range);
    const sinceIso = since ? new Date(`${since}T00:00:00+05:30`).toISOString() : null;

    // Same filters for the list and for the summary, so the summary covers the WHOLE range,
    // not just the rows shown (the list is capped at `limit`).
    const base = (select: string, head = false, statusOverride?: string) => {
      let q = admin
        .from("collection_runs")
        .select(select, head ? { count: "exact", head: true } : undefined);
      if (sinceIso) q = q.gte("started_at", sinceIso);
      if (platform) q = q.eq("platform", platform);
      const st = statusOverride ?? status;
      if (st) q = q.eq("status", st);
      return q;
    };
    const countWhere = async (st?: string): Promise<number> => {
      if (status && st && st !== status) return 0;
      const { count, error } = await base("id", true, st);
      if (error) throw error;
      return count ?? 0;
    };

    const [listRes, total, ok, failed, started, ingesting, partial, usageRows, lastOkRes] = await Promise.all([
      base("*").order("started_at", { ascending: false }).limit(limit),
      countWhere(),
      countWhere("success"),
      countWhere("failed"),
      countWhere("started"),
      countWhere("ingesting"),
      countWhere("partial"),
      fetchAllRows<{ usage_usd: number | string | null }>((from, to) =>
        base("usage_usd")
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: { usage_usd: number | string | null }[] | null;
          error: { message: string } | null;
        }>
      ),
      base("started_at, posts_upserted", false, status ?? "success")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (listRes.error) {
      return internalError(listRes.error, "Failed to load runs");
    }

    const spend = usageRows.reduce((sum, r) => {
      const v = typeof r.usage_usd === "string" ? Number(r.usage_usd) : r.usage_usd;
      return sum + (typeof v === "number" && Number.isFinite(v) ? v : 0);
    }, 0);
    const lastOk =
      status && status !== "success"
        ? null
        : ((lastOkRes.data as { started_at: string; posts_upserted: number } | null) ?? null);

    return NextResponse.json({
      runs: listRes.data || [],
      summary: {
        total,
        ok,
        failed,
        stuck: started + ingesting,
        partial,
        spend,
        lastOk,
        rate: total > 0 ? Math.round((ok / total) * 100) : null,
      },
    });
  } catch (err: unknown) {
    return internalError(err, "Failed to load runs");
  }
}
