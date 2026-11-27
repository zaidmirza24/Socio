import { randomUUID } from "node:crypto";
import type { AdminClient } from "../supabase/admin.ts";

/**
 * Database-wide "a run is being started" lock (migration 20261208_run_start_locks.sql), so two
 * copies of the app (two admins) cannot both start the same paid run within the few seconds a
 * start takes. Complements the in-process lock in scraper-orchestrator.ts.
 *
 * If the migration is not applied yet, the lock is skipped (acquired = true) with one warning:
 * the in-process lock and the "run already active" check still apply.
 */

/** A start that crashed leaves its row behind; after this long another start may take it over. */
export const RUN_START_LOCK_TTL_SECONDS = 120;

export interface RunStartLock {
  acquired: boolean;
  release: () => Promise<void>;
}

let warnedMissing = false;

function isMissingFunction(err: { code?: string } | null): boolean {
  return !!err && (err.code === "PGRST202" || err.code === "42883");
}

export async function acquireRunStartLock(
  client: AdminClient,
  platform: string,
  jobType: "discovery" | "refresh"
): Promise<RunStartLock> {
  const token = randomUUID();
  const { data, error } = await client.rpc("try_lock_run_start", {
    p_platform: platform,
    p_job_type: jobType,
    p_token: token,
    p_ttl_seconds: RUN_START_LOCK_TTL_SECONDS,
  });

  if (isMissingFunction(error)) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn("[run-start-lock] Apply migration 20261208_run_start_locks.sql to guard starts across app copies.");
    }
    return { acquired: true, release: async () => {} };
  }
  if (error) throw new Error(`Could not take the run start lock: ${error.message}`);

  if (data !== true) return { acquired: false, release: async () => {} };
  return {
    acquired: true,
    release: async () => {
      const { error: releaseError } = await client.rpc("release_run_start", {
        p_platform: platform,
        p_job_type: jobType,
        p_token: token,
      });
      // Not fatal: the row expires after the TTL anyway.
      if (releaseError) console.error("[run-start-lock] Could not release:", releaseError.message);
    },
  };
}
