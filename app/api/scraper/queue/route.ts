import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  advanceRefreshQueue,
  cancelRefreshGroup,
  getRefreshGroupProgress,
  isMemoryLimitError,
} from "@/lib/services/scraper-orchestrator";

const payloadSchema = z.object({
  /** Refresh jobs to report on (the `batchGroup` ids returned when they were started). */
  groups: z.array(z.string().uuid()).min(1).max(10),
  /** Stop these jobs from starting any more batches. Batches already running keep going. */
  cancel: z.boolean().optional(),
});

/**
 * POST /api/scraper/queue
 *
 * Admin-only. Starts any queued refresh batches that now fit (so the open panel also keeps the
 * queue moving when no webhook is configured), then reports progress for each job. With
 * `cancel: true` the unstarted batches are dropped first.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid queue request", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const { groups, cancel } = parsed.data;

  try {
    if (cancel) {
      for (const group of groups) await cancelRefreshGroup(group);
    }
    const advance = cancel
      ? { waitingForMemory: false, firstError: null as string | null }
      : await advanceRefreshQueue();
    const progress = await Promise.all(
      groups.map(async (group) => ({ group, ...(await getRefreshGroupProgress(group)) }))
    );
    return NextResponse.json({
      groups: progress,
      waitingForMemory: advance.waitingForMemory,
      error: advance.firstError,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Could not update the refresh queue",
        errorType: isMemoryLimitError(err) ? "MEMORY_FULL" : "SCRAPER",
      },
      { status: 500 }
    );
  }
}
