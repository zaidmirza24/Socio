import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { advanceRefreshQueueQuietly, ingestCompletedJob } from "@/lib/services/scraper-orchestrator";
import {
  WEBHOOK_SECRET_HEADER,
  parseWebhookRunId,
  verifyWebhookSecret,
} from "@/lib/scrapers/apify/webhook";

/**
 * POST /api/webhooks/apify
 *
 * Called by Apify when a run we started ends (success, failure, timeout or abort). It authenticates
 * with a shared secret instead of a login session, then runs the same idempotent ingestion the
 * status poll uses, so a run saved by both paths is still stored exactly once.
 *
 * Only active when APIFY_WEBHOOK_BASE_URL and APIFY_WEBHOOK_SECRET are set; locally, polling does
 * the job. A non-2xx response makes Apify retry, which is what we want for transient failures.
 */
export async function POST(request: NextRequest) {
  const secret = getServerEnv().APIFY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhooks are not enabled on this server." }, { status: 503 });
  }
  if (!verifyWebhookSecret(request.headers.get(WEBHOOK_SECRET_HEADER), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const runId = parseWebhookRunId(body);
  if (!runId) {
    // Not retryable: the payload will never become valid.
    return NextResponse.json({ error: "Not an Apify run event." }, { status: 400 });
  }

  try {
    const result = await ingestCompletedJob(runId);
    // The run has ended, so a slot is free: start the next queued refresh batch. This is what keeps
    // a queued refresh going with nobody watching the Collect panel.
    if (result.state !== "running") await advanceRefreshQueueQuietly();
    return NextResponse.json({ ok: true, runId, state: result.state, message: result.message });
  } catch (err: unknown) {
    // 500 so Apify retries (e.g. the run row was not written yet, or a transient database error).
    const message = err instanceof Error ? err.message : "Ingestion failed";
    console.error(`[apify-webhook] Run ${runId}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
