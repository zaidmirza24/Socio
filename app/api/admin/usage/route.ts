import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { getUsageReport, setUsageBudget, syncPendingUsage } from "@/lib/services/apify-usage";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({
    action: z.literal("set-budget"),
    monthlyUsd: z.number().positive().max(1_000_000).nullable(),
    alertThresholdPct: z.number().int().min(1).max(100).default(80),
  }),
]);

/**
 * GET /api/admin/usage
 * Apify credit usage for this platform (per platform / job type / day), budget status,
 * Apify-account comparison and a monthly cost forecast.
 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    // Opportunistically pull cost for a few finished runs so the numbers are fresh
    await syncPendingUsage(5).catch(() => undefined);
    return NextResponse.json({ report: await getUsageReport() });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load usage" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.format() }, { status: 400 });
  }

  try {
    if (parsed.data.action === "sync") {
      const result = await syncPendingUsage(50);
      return NextResponse.json({
        success: true,
        ...result,
        message: `Checked ${result.checked} run(s); recorded cost for ${result.recorded}.`,
        report: await getUsageReport(),
      });
    }

    await setUsageBudget(
      { monthlyUsd: parsed.data.monthlyUsd, alertThresholdPct: parsed.data.alertThresholdPct },
      guard.userId
    );
    return NextResponse.json({ success: true, report: await getUsageReport() });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Request failed" }, { status: 500 });
  }
}
