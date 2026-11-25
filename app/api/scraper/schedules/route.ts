import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { ApifyConfigError } from "@/lib/apify/client";
import { ScheduleError, createSchedule, listSchedules } from "@/lib/scheduler/service";

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the schedule a name.").max(80),
  mode: z.enum(["once", "range"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD."),
  runTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 09:30."),
  gapMinutes: z.number().int("Gap must be a whole number of minutes.").min(0).max(120).default(10),
  platforms: z.array(z.enum(["instagram", "facebook", "x"])).min(1, "Pick at least one platform.").max(3),
});

function errorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof ScheduleError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ApifyConfigError) return NextResponse.json({ error: err.message }, { status: 400 });
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}

/** GET /api/scraper/schedules: every schedule, soonest first. Admin only. */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ schedules: await listSchedules() });
  } catch (err: unknown) {
    return errorResponse(err, "Could not load schedules");
  }
}

/**
 * POST /api/scraper/schedules: creates a schedule and its Apify Schedules.
 * For a single date, send the same value as startDate and endDate.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body: unknown = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid schedule" }, { status: 400 });
  }
  const input = parsed.data;
  const endDate = input.mode === "once" ? input.startDate : input.endDate;
  try {
    const schedule = await createSchedule({ ...input, endDate }, guard.userId);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err: unknown) {
    return errorResponse(err, "Could not create the schedule");
  }
}
