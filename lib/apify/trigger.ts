import { getApifyClient } from "@/lib/apify/client";
import { createAdminClient } from "@/lib/supabase/admin";

export interface TriggerRunResult {
  success: boolean;
  runId: string;
  defaultDatasetId: string;
  status: string;
}

/**
 * Triggers an on-demand Apify Task run from the application.
 * Note: Daily automation is managed independently by Apify Schedules (8:00 AM IST).
 * This function provides on-demand triggering for immediate refreshes, new account onboarding, or manual testing.
 */
export async function triggerApifyTaskRun(
  taskId: string,
  customInput?: Record<string, unknown>
): Promise<TriggerRunResult> {
  const client = getApifyClient();

  // Trigger Apify Task execution asynchronously
  const run = await client.task(taskId).start(customInput);

  // Log started run into collection_runs
  const supabase = createAdminClient();
  await supabase.from("collection_runs").insert({
    actor_run_id: run.id,
    platform: "instagram",
    started_at: new Date().toISOString(),
    status: "started",
    accounts_targeted: 0,
    posts_found: 0,
    posts_upserted: 0,
    snapshots_created: 0,
  });

  return {
    success: true,
    runId: run.id,
    defaultDatasetId: run.defaultDatasetId,
    status: run.status,
  };
}

