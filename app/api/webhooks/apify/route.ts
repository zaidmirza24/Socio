import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApifyClient, verifyWebhookSecret } from "@/lib/apify/client";
import { normalizeInstagramDataset } from "@/lib/collectors/instagram";
import { processIngestion } from "@/lib/services/ingestion";
import { createAdminClient } from "@/lib/supabase/admin";

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

    if (!verifyWebhookSecret(providedSecret)) {
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
      await supabase.from("collection_runs").insert({
        actor_run_id: actorRunId,
        platform: "instagram",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        error: {
          apify_status: runStatus,
          payload: body,
        },
      });

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

    const apifyClient = getApifyClient();
    const dataset = await apifyClient.dataset(datasetId).listItems({
      clean: true,
    });

    const rawItems = dataset.items || [];

    // 5. Normalize and Ingest
    const normalizedData = normalizeInstagramDataset(rawItems);
    const summary = await processIngestion(normalizedData, { actorRunId });

    return NextResponse.json({
      success: true,
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

