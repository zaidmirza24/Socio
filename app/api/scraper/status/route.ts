import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  checkScraperJobStatus,
  ingestCompletedJob,
} from "@/lib/services/scraper-orchestrator";
import type { ScraperProviderType } from "@/lib/scrapers/types";

/**
 * GET /api/scraper/status?runId=...&provider=apify
 *
 * Checks run progress with the active provider.
 * When the job completes, ingests results idempotently into Supabase.
 */
export async function GET(request: NextRequest) {
  try {
    // Polling ingests data and records spend, so it is admin-only like the trigger.
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId") || searchParams.get("jobId");
    const providerOverride = (searchParams.get("provider") as ScraperProviderType) || undefined;

    if (!runId) {
      return NextResponse.json({ error: "Missing runId parameter" }, { status: 400 });
    }

    // 1. Check live job status from provider
    const jobStatus = await checkScraperJobStatus(runId, providerOverride);

    // 2. If in progress
    if (jobStatus.status === "pending" || jobStatus.status === "running") {
      return NextResponse.json({
        runId: jobStatus.jobId,
        status: jobStatus.status === "pending" ? "READY" : "RUNNING",
        isFinished: false,
        startedAt: jobStatus.startedAt,
        message: "Scraper is actively crawling and fetching data...",
      });
    }

    // 3. If failed
    if (jobStatus.status === "failed") {
      return NextResponse.json({
        runId: jobStatus.jobId,
        status: "FAILED",
        isFinished: true,
        error: jobStatus.error || "Scraper execution failed",
      });
    }

    // 4. If completed, ingest dataset idempotently
    if (jobStatus.status === "completed") {
      const ingestionResult = await ingestCompletedJob(runId, providerOverride);

      return NextResponse.json({
        runId: jobStatus.jobId,
        status: "SUCCEEDED",
        isFinished: true,
        ingested: ingestionResult.ingested,
        postsUpserted: ingestionResult.summary?.postsUpserted ?? 0,
        snapshotsCreated: ingestionResult.summary?.snapshotsCreated ?? 0,
        postsFound: ingestionResult.summary?.postsFound ?? 0,
        accountsProcessed: ingestionResult.summary?.accountsProcessed ?? 0,
        message: ingestionResult.message,
      });
    }

    return NextResponse.json({
      runId: jobStatus.jobId,
      status: "RUNNING",
      isFinished: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error checking scraper status";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
