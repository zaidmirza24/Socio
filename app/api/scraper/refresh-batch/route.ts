import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  MEMORY_FULL_MESSAGE,
  isMemoryLimitError,
  startRefreshBatch,
} from "@/lib/services/scraper-orchestrator";
import { DIRECT_URL_BATCH_SIZE } from "@/lib/config/batching";

const payloadSchema = z.object({
  platform: z.enum(["instagram", "facebook", "x"]),
  // One batch only, so a single request can never start an arbitrarily large run.
  urls: z.array(z.string().url().max(500)).min(1).max(DIRECT_URL_BATCH_SIZE),
});

/**
 * POST /api/scraper/refresh-batch
 *
 * Admin-only. Starts ONE queued refresh batch (the ones /api/scraper/trigger-all could not start
 * yet). The client calls this as running batches finish. Responds 429 `MEMORY_FULL` when Apify's
 * account memory limit is still used up, so the client keeps the batch queued and retries.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid refresh batch payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  try {
    const { jobId } = await startRefreshBatch(parsed.data.platform, parsed.data.urls);
    return NextResponse.json({ success: true, runId: jobId });
  } catch (err: unknown) {
    if (isMemoryLimitError(err)) {
      return NextResponse.json({ error: MEMORY_FULL_MESSAGE, errorType: "MEMORY_FULL" }, { status: 429 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start refresh batch", errorType: "SCRAPER" },
      { status: 500 }
    );
  }
}
