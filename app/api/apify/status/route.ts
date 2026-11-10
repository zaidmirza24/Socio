import { NextRequest, NextResponse } from "next/server";
import { getApifyClient, deleteApifyDataset } from "@/lib/apify/client";
import { normalizeInstagramDataset } from "@/lib/collectors/instagram";
import { processIngestion } from "@/lib/services/ingestion";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabaseUser = createServerComponentClient();
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Team login required" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "Missing runId parameter" }, { status: 400 });
    }

    const client = getApifyClient();
    const admin = createAdminClient();

    // 1. Fetch current run details from Apify
    const run = await client.run(runId).get();

    if (!run) {
      return NextResponse.json({ error: `Apify run with ID ${runId} not found` }, { status: 404 });
    }

    const status = run.status;

    // 2. If run is still in progress
    if (status === "READY" || status === "RUNNING") {
      return NextResponse.json({
        runId: run.id,
        status,
        isFinished: false,
        startedAt: run.startedAt,
        message: "Scraper is actively crawling Instagram profiles...",
      });
    }

    // 3. If run failed or timed out
    if (status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED") {
      await admin
        .from("collection_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          error: { apifyStatus: status },
        })
        .eq("actor_run_id", run.id);

      return NextResponse.json({
        runId: run.id,
        status,
        isFinished: true,
        error: `Scraper execution ended with status: ${status}`,
      });
    }

    // 4. If run SUCCEEDED, check if already ingested to remain idempotent
    if (status === "SUCCEEDED") {
      const { data: existingLog } = await admin
        .from("collection_runs")
        .select("status, posts_upserted, snapshots_created")
        .eq("actor_run_id", run.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      if (existingLog && existingLog.status === "success") {
        return NextResponse.json({
          runId: run.id,
          status: "SUCCEEDED",
          isFinished: true,
          ingested: true,
          postsUpserted: existingLog.posts_upserted,
          snapshotsCreated: existingLog.snapshots_created,
          message: "Data has been ingested and updated in Supabase.",
        });
      }

      // 5. Ingest dataset directly
      const datasetId = run.defaultDatasetId;
      if (!datasetId) {
        return NextResponse.json(
          { error: "Run succeeded but defaultDatasetId is missing" },
          { status: 500 }
        );
      }

      const dataset = await client.dataset(datasetId).listItems({ clean: true });
      const rawItems = dataset.items || [];

      // Normalize items through Instagram adapter
      const normalized = normalizeInstagramDataset(rawItems);

      // Ingest and upsert into database
      const summary = await processIngestion(normalized, {
        actorRunId: run.id,
      });

      // Cleanup Apify dataset after successful ingestion
      await deleteApifyDataset(datasetId);

      return NextResponse.json({
        runId: run.id,
        status: "SUCCEEDED",
        isFinished: true,
        ingested: true,
        accountsProcessed: summary.accountsProcessed,
        postsFound: summary.postsFound,
        postsUpserted: summary.postsUpserted,
        snapshotsCreated: summary.snapshotsCreated,
        errors: summary.errors,
        message: `Successfully ingested ${summary.postsUpserted} posts and ${summary.snapshotsCreated} daily snapshots.`,
      });
    }

    return NextResponse.json({
      runId: run.id,
      status,
      isFinished: false,
    });
  } catch (err: unknown) {
    const { parseApifyError } = await import("@/lib/apify/client");
    const parsed = parseApifyError(err);
    return NextResponse.json(
      { error: parsed.message, errorType: "APIFY" },
      { status: parsed.statusCode }
    );
  }
}

