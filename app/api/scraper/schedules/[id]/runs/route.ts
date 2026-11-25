import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { ScheduleError, getScheduleAccountDetail, getScheduleProgress } from "@/lib/scheduler/service";

const idSchema = z.string().uuid();
const detailSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  platform: z.enum(["instagram", "facebook", "x"]),
});

/**
 * GET /api/scraper/schedules/:id/runs
 *   -> what each planned run did (per day and platform) and overall totals.
 * GET /api/scraper/schedules/:id/runs?date=YYYY-MM-DD&platform=instagram
 *   -> per-account result of that run day.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const id = idSchema.safeParse(params.id);
  if (!id.success) return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.has("date") || searchParams.has("platform")) {
      const q = detailSchema.safeParse({ date: searchParams.get("date"), platform: searchParams.get("platform") });
      if (!q.success) return NextResponse.json({ error: "Invalid date or platform" }, { status: 400 });
      return NextResponse.json(await getScheduleAccountDetail(id.data, q.data.date, q.data.platform));
    }
    return NextResponse.json(await getScheduleProgress(id.data));
  } catch (err: unknown) {
    if (err instanceof ScheduleError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load runs" }, { status: 500 });
  }
}
