import { getApifyClient, getApifyTaskId, getApifyActorId, ApifyConfigError } from "@/lib/apify/client";
import { createAdminClient } from "@/lib/supabase/admin";

export interface TriggerRunResult {
  success: boolean;
  runId: string;
  defaultDatasetId: string;
  status: string;
  accountsCount: number;
  targetHandles: string[];
  executionMode: "task" | "actor";
  executionTarget: string;
}

export interface TriggerOptions {
  taskId?: string;
  actorId?: string;
  postLimit?: number;
  customHandles?: string[];
  customInput?: Record<string, unknown>;
}

/**
 * Pre-flight validation result returned before attempting to start a run.
 */
export interface PreflightResult {
  valid: boolean;
  errors: string[];
  activeAccountCount: number;
  executionMode: "task" | "actor";
  executionTarget: string;
}

/**
 * Validates all prerequisites before starting a scraper run.
 * Returns detailed, actionable errors for anything misconfigured.
 */
export async function preflightCheck(options: TriggerOptions = {}): Promise<PreflightResult> {
  const errors: string[] = [];
  let activeAccountCount = 0;

  // 1. Validate Apify client can be created (checks token)
  try {
    getApifyClient();
  } catch (err: unknown) {
    if (err instanceof ApifyConfigError) {
      errors.push(err.message);
    } else {
      errors.push("Failed to initialize Apify client: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // 2. Check execution target
  const taskId = getApifyTaskId(options.taskId);
  const actorId = getApifyActorId(options.actorId);
  const executionMode: "task" | "actor" = taskId ? "task" : "actor";
  const executionTarget = taskId || actorId;

  // 3. Check active accounts
  if (options.customHandles && options.customHandles.length > 0) {
    activeAccountCount = options.customHandles.length;
  } else {
    try {
      const supabase = createAdminClient();
      const { data: accounts, error: accError } = await supabase
        .from("accounts")
        .select("handle")
        .eq("platform", "instagram")
        .eq("status", "active");

      if (accError) {
        errors.push(`Database error while querying accounts: ${accError.message}`);
      } else if (!accounts || accounts.length === 0) {
        errors.push(
          "No active Instagram accounts found in the database. " +
          "Go to the Accounts page to add volunteer profiles before running the scraper."
        );
      } else {
        activeAccountCount = accounts.length;
      }
    } catch (err: unknown) {
      errors.push(
        "Failed to connect to database: " + (err instanceof Error ? err.message : String(err))
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    activeAccountCount,
    executionMode,
    executionTarget,
  };
}

/**
 * Triggers an on-demand Apify Task/Actor run using active accounts from Supabase.
 * Runs a full preflight check first and throws descriptive errors for any issue.
 */
export async function triggerApifyTaskRun(
  options: TriggerOptions = {}
): Promise<TriggerRunResult> {
  // 1. Run preflight validation
  const preflight = await preflightCheck(options);
  if (!preflight.valid) {
    throw new ApifyConfigError(
      "Pre-flight check failed:\n• " + preflight.errors.join("\n• ")
    );
  }

  const supabase = createAdminClient();
  const client = getApifyClient();

  // 2. Determine target accounts
  let targetHandles: string[];

  if (options.customHandles && options.customHandles.length > 0) {
    targetHandles = options.customHandles.map((h) => h.replace(/^@/, "").trim().toLowerCase());
  } else {
    const { data: accounts, error: accError } = await supabase
      .from("accounts")
      .select("handle")
      .eq("platform", "instagram")
      .eq("status", "active");

    if (accError) {
      throw new Error(`Database error querying active accounts: ${accError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      throw new Error(
        "No active Instagram accounts found. Add accounts in the Accounts tab first."
      );
    }

    targetHandles = accounts.map((a) => a.handle.replace(/^@/, "").trim().toLowerCase());
  }

  const postLimit = options.postLimit || 10;
  const directUrls = targetHandles.map((handle) => `https://www.instagram.com/${handle}/`);

  // 3. Build dynamic input payload for the Instagram Scraper
  const dynamicInput: Record<string, unknown> = {
    usernames: targetHandles,
    directUrls,
    resultsLimit: postLimit,
    resultsType: "posts",
    searchType: "user",
    ...(options.customInput || {}),
  };

  // 4. Resolve execution mode
  const taskId = getApifyTaskId(options.taskId);
  const actorId = getApifyActorId(options.actorId);

  // 5. Start Apify execution
  let run;
  let executionMode: "task" | "actor";
  let executionTarget: string;

  try {
    if (taskId) {
      executionMode = "task";
      executionTarget = taskId;
      run = await client.task(taskId).start(dynamicInput);
    } else {
      executionMode = "actor";
      executionTarget = actorId;
      run = await client.actor(actorId).start(dynamicInput);
    }
  } catch (err: unknown) {
    // Re-throw with context about what we tried to run
    const target = taskId ? `Task "${taskId}"` : `Actor "${actorId}"`;
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to start Apify ${target}: ${detail}`
    );
  }

  // 6. Log initial run into collection_runs (non-blocking, don't fail the trigger if logging fails)
  try {
    await supabase.from("collection_runs").insert({
      actor_run_id: run.id,
      platform: "instagram",
      started_at: new Date().toISOString(),
      status: "started",
      accounts_targeted: targetHandles.length,
      posts_found: 0,
      posts_upserted: 0,
      snapshots_created: 0,
    });
  } catch (logErr: unknown) {
    // Audit log failure should not prevent the run from being reported to the user
    console.error(
      "[collection_runs] Failed to log run start:",
      logErr instanceof Error ? logErr.message : logErr
    );
  }

  return {
    success: true,
    runId: run.id,
    defaultDatasetId: run.defaultDatasetId,
    status: run.status,
    accountsCount: targetHandles.length,
    targetHandles,
    executionMode,
    executionTarget,
  };
}
