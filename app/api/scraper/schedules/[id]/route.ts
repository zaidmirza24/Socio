import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { ApifyConfigError } from "@/lib/apify/client";
import { ScheduleError, deleteSchedule, resyncSchedule, setScheduleEnabled } from "@/lib/scheduler/service";

const idSchema = z.string().uuid();
const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("refresh-accounts") }),
]);

function errorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof ScheduleError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ApifyConfigError) return NextResponse.json({ error: err.message }, { status: 400 });
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status: 500 });
}

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/scraper/schedules/:id  { action: "pause" | "resume" | "refresh-accounts" } */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });
  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const schedule =
      body.data.action === "refresh-accounts"
        ? await resyncSchedule(id.data)
        : await setScheduleEnabled(id.data, body.data.action === "resume");
    return NextResponse.json({ schedule });
  } catch (err: unknown) {
    return errorResponse(err, "Could not update the schedule");
  }
}

/** DELETE /api/scraper/schedules/:id: removes the schedule and its Apify Schedules. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Invalid schedule id" }, { status: 400 });
  try {
    await deleteSchedule(id.data);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return errorResponse(err, "Could not delete the schedule");
  }
}
