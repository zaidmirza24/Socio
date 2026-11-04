import { NextRequest, NextResponse } from "next/server";
import { triggerApifyTaskRun } from "@/lib/apify/trigger";
import { createServerComponentClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    // 1. Ensure user is authenticated
    const supabase = createServerComponentClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // In local dev without auth session, allow fallback authorization header check
    const authHeader = request.headers.get("authorization");
    const isDev = process.env.NODE_ENV !== "production";

    if (!user && !(isDev && authHeader === "Bearer dev-override")) {
      return NextResponse.json(
        { error: "Unauthorized: Team login required to dispatch scraper runs" },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const taskId = body.taskId || process.env.APIFY_TASK_ID;

    if (!taskId) {
      return NextResponse.json(
        { error: "Missing taskId. Provide taskId in request body or set APIFY_TASK_ID in environment." },
        { status: 400 }
      );
    }

    const result = await triggerApifyTaskRun(taskId, body.input);

    return NextResponse.json({
      success: true,
      message: "Scraping Task successfully dispatched to Apify Cloud. Webhook will ingest results upon completion.",
      runId: result.runId,
      status: result.status,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to trigger Apify task";
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}

