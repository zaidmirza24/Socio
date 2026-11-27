/**
 * The database-wide run start lock (migration 20261208_run_start_locks.sql via
 * lib/services/run-start-lock.ts) on a real Postgres with every migration applied.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/test-db.ts";
import { pgliteSupabase } from "./helpers/pglite-supabase.ts";
import { acquireRunStartLock } from "../lib/services/run-start-lock.ts";
import type { AdminClient } from "../lib/supabase/admin.ts";

let db: PGlite;
let client: AdminClient;

before(async () => {
  db = await createTestDb();
  client = pgliteSupabase(db) as unknown as AdminClient;
});

after(async () => {
  await db.close();
});

describe("run start lock", () => {
  it("only one start at a time per platform and job type", async () => {
    const first = await acquireRunStartLock(client, "instagram", "discovery");
    assert.strictEqual(first.acquired, true);

    const second = await acquireRunStartLock(client, "instagram", "discovery");
    assert.strictEqual(second.acquired, false, "a second app copy must wait");

    const otherJob = await acquireRunStartLock(client, "instagram", "refresh");
    const otherPlatform = await acquireRunStartLock(client, "facebook", "discovery");
    assert.strictEqual(otherJob.acquired, true, "different job type is independent");
    assert.strictEqual(otherPlatform.acquired, true, "different platform is independent");

    await first.release();
    await otherJob.release();
    await otherPlatform.release();
    const third = await acquireRunStartLock(client, "instagram", "discovery");
    assert.strictEqual(third.acquired, true, "free again after release");
    await third.release();
  });

  it("a crashed start's lock is taken over after the timeout, and the old holder cannot free the new lock", async () => {
    const crashed = await acquireRunStartLock(client, "x", "discovery");
    assert.strictEqual(crashed.acquired, true);

    // Pretend the holder died an hour ago.
    await db.query("UPDATE run_start_locks SET locked_at = NOW() - INTERVAL '1 hour' WHERE platform = 'x'");
    const takeover = await acquireRunStartLock(client, "x", "discovery");
    assert.strictEqual(takeover.acquired, true);

    await crashed.release(); // the stale holder wakes up and "releases"
    const third = await acquireRunStartLock(client, "x", "discovery");
    assert.strictEqual(third.acquired, false, "the takeover's lock must still hold");

    await takeover.release();
    const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM run_start_locks");
    assert.strictEqual(rows.rows[0].n, 0);
  });

  it("team members cannot touch the lock table or functions", async () => {
    const grants = await db.query<{ tbl: boolean; fn: boolean }>(
      `SELECT has_table_privilege('authenticated', 'run_start_locks', 'SELECT') AS tbl,
              has_function_privilege('authenticated', 'try_lock_run_start(text,text,uuid,integer)', 'EXECUTE') AS fn`
    );
    assert.deepStrictEqual(grants.rows[0], { tbl: false, fn: false });
  });
});
