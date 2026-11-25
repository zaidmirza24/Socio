import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { syncScheduledRuns } from "@/lib/scheduler/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/scraper/schedules/sync
 *
 * Apify starts scheduled runs by itself, so this app finds out afterwards: it records the runs the
 * schedules started and saves the finished ones, the same ingestion a manual run uses. The
 * dashboard calls this every minute while an admin has it open; calling it more often is harmless
 * (every step is idempotent), and runs that finished while nobody was watching are saved the next
 * time an admin opens the app.
 */
export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await syncScheduledRuns());
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not check scheduled runs" },
      { status: 500 }
    );
  }
}
