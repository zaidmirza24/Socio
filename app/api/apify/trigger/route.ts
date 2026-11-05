import { NextRequest, NextResponse } from "next/server";
import { triggerApifyTaskRun, preflightCheck } from "@/lib/apify/trigger";
import { ApifyConfigError, parseApifyError } from "@/lib/apify/client";
import { createServerComponentClient } from "@/lib/supabase/server";

/**
 * POST /api/apify/trigger
 *
 * Dispatches an on-demand Apify scraper run.
 * Runs a preflight check first and returns structured, actionable errors.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const supabase = createServerComponentClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const authHeader = request.headers.get("authorization");
    const isDev = process.env.NODE_ENV !== "production";

    if (!user && !(isDev && authHeader === "Bearer dev-override")) {
      return NextResponse.json(
        {
          error: "Unauthorized: Team login required to dispatch scraper runs.",
          errorType: "AUTH",
        },
        { status: 401 }
      );
    }

    // 2. Parse request body
    const body = await request.json().catch(() => ({}));
    const postLimit = typeof body.postLimit === "number" ? body.postLimit : 10;
    const taskId = body.taskId || undefined;
    const actorId = body.actorId || undefined;
    const customHandles = Array.isArray(body.handles) ? body.handles : undefined;

    const triggerOptions = {
      taskId,
      actorId,
      postLimit,
      customHandles,
      customInput: body.customInput,
    };

    // 3. Pre-flight validation (fast, no Apify API call)
    const preflight = await preflightCheck(triggerOptions);

    if (!preflight.valid) {
      return NextResponse.json(
        {
          error: preflight.errors.join(" "),
          errorType: "CONFIG",
          details: preflight.errors,
          executionMode: preflight.executionMode,
          executionTarget: preflight.executionTarget,
        },
        { status: 400 }
      );
    }

    // 4. Dispatch to Apify
    const result = await triggerApifyTaskRun(triggerOptions);

    return NextResponse.json({
      success: true,
      message: `Scraping run dispatched for ${result.accountsCount} active account(s) via ${result.executionMode} "${result.executionTarget}" (${postLimit} posts each).`,
      runId: result.runId,
      defaultDatasetId: result.defaultDatasetId,
      status: result.status,
      accountsCount: result.accountsCount,
      targetHandles: result.targetHandles,
      executionMode: result.executionMode,
    });
  } catch (err: unknown) {
    // Classify the error for the UI
    if (err instanceof ApifyConfigError) {
      return NextResponse.json(
        {
          error: err.message,
          errorType: "CONFIG",
        },
        { status: 400 }
      );
    }

    const parsed = parseApifyError(err);
    return NextResponse.json(
      {
        error: parsed.message,
        errorType: "APIFY",
      },
      { status: parsed.statusCode }
    );
  }
}
