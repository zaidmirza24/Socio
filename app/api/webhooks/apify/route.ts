import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApifyClientAsync, verifyWebhookSecretAsync, deleteApifyDataset } from "@/lib/apify/client";
import { recordRunUsage } from "@/lib/services/apify-usage";
import { normalizePlatformDataset } from "@/lib/scrapers/platform-adapter";
import { processIngestion } from "@/lib/services/ingestion";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlatformType } from "@/types/database";

/**
 * Standard Apify Webhook Payload schema
 */
const apifyWebhookPayloadSchema = z.object({
  eventType: z.string().optional(),
  eventData: z
    .object({
      actorId: z.string().optional(),
      actorRunId: z.string().optional(),
      defaultDatasetId: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  resource: z
    .object({
      id: z.string().optional(),
      actId: z.string().optional(),
      status: z.string().optional(),
      defaultDatasetId: z.string().optional(),
    })
    .optional(),
}).passthrough();

export async function POST(request: NextRequest) {
  try {
    // 1. Verify Webhook Secret
    const headerSecret = request.headers.get("x-apify-webhook-secret");
    const querySecret = request.nextUrl.searchParams.get("secret");
    const providedSecret = headerSecret || querySecret;

    if (!(await verifyWebhookSecretAsync(providedSecret))) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing webhook secret" },
        { status: 401 }
      );
    }

    // 2. Parse and validate webhook body
    const body = await request.json();
    const parsedPayload = apifyWebhookPayloadSchema.safeParse(body);

    if (!parsedPayload.success) {
      return NextResponse.json(
        { error: "Invalid Apify webhook payload structure", details: parsedPayload.error.format() },
        { status: 400 }
      );
    }

    const payload = parsedPayload.data;
    const actorRunId =
      payload.eventData?.actorRunId || payload.resource?.id || "unknown-run";
    const datasetId =
      payload.eventData?.defaultDatasetId || payload.resource?.defaultDatasetId;
    const runStatus =
      payload.eventData?.status || payload.resource?.status || "SUCCEEDED";

    // 3. Handle failed Apify runs
    if (runStatus === "FAILED" || runStatus === "TIMED-OUT" || runStatus === "ABORTED") {
      const supabase = createAdminClient();
      const { data: runMeta } = await supabase
        .from("collection_runs")
        .select("id, platform")
        .eq("actor_run_id", actorRunId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const platform = (runMeta?.platform as PlatformType) || "instagram";
      const failure = {
        completed_at: new Date().toISOString(),
        status: "failed",
        error: { apify_status: runStatus, payload: body },
      };

      // Update the existing audit row (never insert a duplicate for the same Apify run)
      if (runMeta?.id) {
        await supabase.from("collection_runs").update(failure).eq("id", runMeta.id);
      } else {
        await supabase
          .from("collection_runs")
          .insert({ actor_run_id: actorRunId, platform, started_at: new Date().toISOString(), ...failure });
      }

      // Failed runs still cost money - record it
      await recordRunUsage(actorRunId);

      return NextResponse.json({
        message: "Logged failed Apify actor run in collection_runs",
        actorRunId,
        status: runStatus,
      });
    }

    // 4. Retrieve dataset records from Apify
    if (!datasetId) {
      return NextResponse.json(
        { error: "Missing datasetId in webhook payload" },
        { status: 400 }
      );
    }

    // Idempotency: Apify retries webhooks and the dashboard poller may already have ingested this run
    const { data: priorRun } = await createAdminClient()
      .from("collection_runs")
      .select("status")
      .eq("actor_run_id", actorRunId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorRun?.status === "success") {
      await recordRunUsage(actorRunId);
      return NextResponse.json({ success: true, duplicate: true, message: "Run already ingested" });
    }

    const apifyClient = await getApifyClientAsync();
    const dataset = await apifyClient.dataset(datasetId).listItems({
      clean: true,
    });

    const rawItems = dataset.items || [];

    // 5. Look up run metadata for platform & job type, normalize and Ingest
    const { data: runMeta } = await createAdminClient()
      .from("collection_runs")
      .select("platform, job_type")
      .eq("actor_run_id", actorRunId)
      .maybeSingle();

    const platform = (runMeta?.platform as PlatformType) || "instagram";
    const normalizedData = normalizePlatformDataset(platform, rawItems);

    const summary = await processIngestion(normalizedData, {
      actorRunId,
      provider: "apify",
      jobType: (runMeta?.job_type as "discovery" | "refresh") || "discovery",
      platform,
    });

    // 6. Only delete the Apify dataset when EVERYTHING was saved. If saving failed or was partial,
    //    keep the raw data so the run can be retried (Apify keeps datasets for its own retention period).
    if (summary.status === "success") {
      await deleteApifyDataset(datasetId);
    }

    // 7. Record what this run cost us on Apify (powers Settings → Credit Usage)
    const usage = await recordRunUsage(actorRunId);

    if (summary.status === "failed") {
      // Non-2xx makes Apify retry the webhook; the dataset is still there.
      return NextResponse.json(
        { error: "Ingestion failed; dataset kept for retry", summary },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      usageRecorded: usage.recorded,
      summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Apify webhook ingestion error:", error);

    return NextResponse.json(
      {
        error: "Ingestion pipeline failure",
        details: message,
      },
      { status: 500 }
    );
  }
}

