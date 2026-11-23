import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApifyRunAccessError } from "@/lib/apify/client";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { advanceRefreshQueueQuietly, ingestCompletedJob } from "@/lib/services/scraper-orchestrator";

const querySchema = z.object({
  runId: z
    .string()
    .trim()
    .min(1, "Missing runId parameter")
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, "Invalid runId"),
  provider: z.enum(["apify"]).optional(),
});

/**
 * GET /api/scraper/status?runId=...&provider=apify
 *
 * Checks run progress with the active provider. When the run has finished, the first request to
 * claim it ingests the dataset (idempotent); concurrent polls get RUNNING until it is saved.
 *
 * Response `status`: RUNNING (crawling or being saved), SUCCEEDED, FAILED.
 */
export async function GET(request: NextRequest) {
  try {
    // Polling ingests data and records spend, so it is admin-only like the trigger.
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      runId: searchParams.get("runId") ?? searchParams.get("jobId") ?? "",
      provider: searchParams.get("provider") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid query" },
        { status: 400 }
      );
    }
    const { runId, provider } = parsed.data;

    const result = await ingestCompletedJob(runId, provider);
    // A finished run frees a slot for the next queued refresh batch.
    if (result.state === "succeeded" || result.state === "failed") await advanceRefreshQueueQuietly();

    if (result.state === "running" || result.state === "ingesting") {
      return NextResponse.json({
        runId,
        status: "RUNNING",
        phase: result.state === "ingesting" ? "saving" : "crawling",
        isFinished: false,
        message: result.message,
      });
    }

    if (result.state === "failed") {
      return NextResponse.json({
        runId,
        status: "FAILED",
        isFinished: true,
        error: result.message,
        message: result.message,
      });
    }

    return NextResponse.json({
      runId,
      status: "SUCCEEDED",
      isFinished: true,
      // false when an earlier request already saved this run (no counts or gain to report)
      ingested: Boolean(result.summary),
      postsUpserted: result.summary?.postsUpserted ?? 0,
      snapshotsCreated: result.summary?.snapshotsCreated ?? 0,
      postsFound: result.summary?.postsFound ?? 0,
      // Present only for the request that actually saved the data; null if it was saved earlier.
      gain: result.summary?.gain ?? null,
      accountsProcessed: result.summary?.accountsProcessed ?? 0,
      message: result.message,
    });
  } catch (err: unknown) {
    if (err instanceof ApifyRunAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : "Error checking scraper status";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
