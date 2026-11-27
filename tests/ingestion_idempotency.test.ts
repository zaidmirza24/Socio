/**
 * AGENTS.md §5 "Idempotency Tests": running the ingestion pipeline twice on identical input must
 * yield zero duplicate rows and exactly one snapshot per post per date.
 *
 * This runs the REAL processIngestion (lib/services/ingestion.ts) against a REAL Postgres: PGlite
 * with every production migration applied (tests/helpers/test-db.ts), reached through a small
 * PostgREST-compatible adapter (tests/helpers/pglite-supabase.ts). The input is the Instagram
 * fixture, normalized by the real adapter.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/test-db.ts";
import { pgliteSupabase, adapterStats } from "./helpers/pglite-supabase.ts";
import { processIngestion, type IngestionOptions } from "../lib/services/ingestion.ts";
import { normalizeInstagramDataset } from "../lib/collectors/instagram.ts";
import { processCaption } from "../lib/matching/normalizer.ts";
import type { AdapterResult } from "../lib/collectors/instagram.ts";
import type { AdminClient } from "../lib/supabase/admin.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/apify_instagram_dataset.json", import.meta.url), "utf8")
) as unknown;
const base: AdapterResult = normalizeInstagramDataset(fixture as Parameters<typeof normalizeInstagramDataset>[0]);
const [POST1, POST2, POST3] = base.posts.map((p) => p.platform_post_id);

let db: PGlite;
let client: AdminClient;

/** A copy of the fixture with every post's metrics changed by `f`. */
function withMetrics(f: (m: AdapterResult["posts"][number]["metrics"], id: string) => AdapterResult["posts"][number]["metrics"]): AdapterResult {
  return {
    accounts: new Map(base.accounts),
    posts: base.posts.map((p) => ({ ...p, metrics: f({ ...p.metrics }, p.platform_post_id) })),
  };
}

function ingest(data: AdapterResult, extra: Partial<IngestionOptions> = {}) {
  return processIngestion(data, {
    db: client,
    actorRunId: "apify-run-1",
    targetDate: "2026-11-03",
    enforceDayWindow: false, // the fixture's posts are from earlier days
    jobType: "discovery",
    platform: "instagram",
    ...extra,
  });
}

async function count(table: string): Promise<number> {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return r.rows[0].n;
}

async function tableCounts(): Promise<Record<string, number>> {
  const tables = [
    "collection_runs", "posts", "post_snapshots", "account_snapshots",
    "matched_posts", "metric_snapshots", "review_queue",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = await count(t);
  return out;
}

async function snapshot(postId: string, day: string) {
  const r = await db.query<{ likes: number | null; comments: number | null; views: number | null }>(
    `SELECT s.likes, s.comments, s.views FROM post_snapshots s JOIN posts p ON p.id = s.post_id
     WHERE p.platform_post_id = $1 AND s.snapshot_date = $2`,
    [postId, day]
  );
  return r.rows;
}

async function label(postId: string): Promise<string> {
  const r = await db.query<{ match_status: string }>("SELECT match_status FROM posts WHERE platform_post_id = $1", [postId]);
  return r.rows[0]?.match_status;
}

before(async () => {
  db = await createTestDb();
  client = pgliteSupabase(db) as unknown as AdminClient;

  for (const handle of ["volunteer_alice", "volunteer_bob"]) {
    await db.query(
      "INSERT INTO accounts (platform, handle, volunteer_name, status) VALUES ('instagram', $1, $1, 'active')",
      [handle]
    );
  }
  await db.query(
    `INSERT INTO system_settings (key, value) VALUES ('feature_settings', '{"campaign_captions_enabled": true}'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  );

  // Caption A: exactly post 1's text, released the same IST day -> matched.
  // Caption B: post 2's text with one word changed, same IST day -> fuzzy -> review queue.
  // Post 3 has no caption -> unmatched.
  const captions = [
    { title: "A", text: base.posts[0].caption ?? "", released: "2026-11-03T04:00:00Z" },
    { title: "B", text: (base.posts[1].caption ?? "").replace("everyone", "everybody"), released: "2026-11-02T03:00:00Z" },
  ];
  for (const c of captions) {
    const { normalized, hash } = processCaption(c.text);
    await db.query(
      `INSERT INTO campaign_captions (title, canonical_caption, normalized_caption, caption_hash, released_at, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [c.title, c.text, normalized, hash, c.released]
    );
  }
});

after(async () => {
  await db.close();
});

describe("ingestion is idempotent on a real Postgres", () => {
  let afterFirst: Record<string, number>;

  it("first run stores everything and labels each post", async () => {
    const summary = await ingest(base);
    assert.deepStrictEqual(summary.errors, []);
    assert.strictEqual(summary.status, "success");

    afterFirst = await tableCounts();
    assert.strictEqual(afterFirst.posts, 3, "every post is kept");
    assert.strictEqual(afterFirst.post_snapshots, 3, "one snapshot per post");
    assert.strictEqual(afterFirst.account_snapshots, 2, "one snapshot per account");
    assert.strictEqual(afterFirst.collection_runs, 1);
    assert.strictEqual(afterFirst.matched_posts, 1);
    assert.strictEqual(afterFirst.metric_snapshots, 1);
    assert.strictEqual(afterFirst.review_queue, 1);

    assert.strictEqual(await label(POST1), "matched");
    assert.strictEqual(await label(POST2), "needs_review");
    assert.strictEqual(await label(POST3), "unmatched");
  });

  it("null (not measured) and 0 (measured zero) are stored as given", async () => {
    assert.strictEqual((await snapshot(POST2, "2026-11-03"))[0].likes, null, "hidden likes stay null");
    assert.strictEqual((await snapshot(POST3, "2026-11-03"))[0].comments, 0, "a real zero stays 0");
  });

  it("running the identical input again creates zero new rows", async () => {
    const summary = await ingest(base);
    assert.deepStrictEqual(summary.errors, []);
    assert.deepStrictEqual(await tableCounts(), afterFirst);
  });

  it("a new day adds exactly one snapshot per post, and tracks growth", async () => {
    const nextDay = withMetrics((m) => ({ ...m, likes: m.likes === null ? null : m.likes + 10 }));
    await ingest(nextDay, { actorRunId: "apify-run-2", targetDate: "2026-11-04" });
    await ingest(nextDay, { actorRunId: "apify-run-2", targetDate: "2026-11-04" }); // and again

    const c = await tableCounts();
    assert.strictEqual(c.posts, 3);
    assert.strictEqual(c.post_snapshots, 6, "3 posts x 2 days");
    assert.strictEqual(c.collection_runs, 2, "one audit row per provider run");
    assert.strictEqual(c.metric_snapshots, 2);

    const dupes = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM (SELECT post_id, snapshot_date FROM post_snapshots GROUP BY 1, 2 HAVING count(*) > 1) d"
    );
    assert.strictEqual(dupes.rows[0].n, 0, "never two snapshots for the same post and day");

    const delta = await db.query<{ delta_likes: number | null }>(
      "SELECT delta_likes FROM metric_snapshots WHERE snapshot_date = '2026-11-04'"
    );
    assert.strictEqual(delta.rows[0].delta_likes, 10);
  });

  it("a same-day re-run that could not measure a metric never erases the earlier value", async () => {
    const before = (await snapshot(POST1, "2026-11-04"))[0].likes;
    assert.strictEqual(typeof before, "number");
    const blind = withMetrics((m, id) => (id === POST1 ? { ...m, likes: null } : m));
    await ingest(blind, { actorRunId: "apify-run-3", targetDate: "2026-11-04" });
    assert.strictEqual((await snapshot(POST1, "2026-11-04"))[0].likes, before);
  });

  it("an admin's review decision survives re-ingestion", async () => {
    await db.query("UPDATE review_queue SET status = 'rejected'");
    await ingest(base, { actorRunId: "apify-run-4", targetDate: "2026-11-05" });

    const r = await db.query<{ status: string; n: number }>(
      "SELECT status, count(*) OVER ()::int AS n FROM review_queue"
    );
    assert.strictEqual(r.rows[0].n, 1, "not queued a second time");
    assert.strictEqual(r.rows[0].status, "rejected", "decision kept");
    assert.strictEqual(await label(POST2), "rejected");
  });

  it("a large run is written in bulk: 1,200 posts, re-run adds nothing, few round-trips", async () => {
    const day = "2026-11-07";
    const template = base.posts[2]; // volunteer_bob's post, no caption match -> unmatched
    const bulk: AdapterResult = {
      accounts: new Map(base.accounts),
      posts: Array.from({ length: 1200 }, (_, i) => ({
        ...template,
        platform_post_id: `bulk-${i}`,
        url: `https://instagram.com/p/bulk-${i}/`,
        caption: `bulk post ${i}`,
        // Mixed column sets: some rows carry likes, some do not (must not become NULL-over-value).
        metrics: { ...template.metrics, likes: i % 3 === 0 ? null : i, comments: i % 5 },
      })),
    };

    const postsBefore = await count("posts");
    adapterStats.queries = 0;
    const first = await ingest(bulk, { actorRunId: "apify-run-bulk", targetDate: day });
    const roundTrips = adapterStats.queries;
    assert.deepStrictEqual(first.errors, []);
    assert.strictEqual(first.postsUpserted, 1200);
    assert.strictEqual(await count("posts"), postsBefore + 1200);
    // Per-post code needed ~3 round-trips per post (3,600+); batched it is a few dozen.
    assert.ok(roundTrips < 60, `expected bulk writes, got ${roundTrips} round-trips`);

    const second = await ingest(bulk, { actorRunId: "apify-run-bulk", targetDate: day });
    assert.deepStrictEqual(second.errors, []);
    assert.strictEqual(await count("posts"), postsBefore + 1200, "re-run adds no posts");
    const snaps = await db.query<{ n: number; nulls: number }>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE s.likes IS NULL)::int AS nulls
       FROM post_snapshots s JOIN posts p ON p.id = s.post_id
       WHERE s.snapshot_date = $1 AND p.platform_post_id LIKE 'bulk-%'`,
      [day]
    );
    assert.strictEqual(snaps.rows[0].n, 1200, "one snapshot per post");
    assert.strictEqual(snaps.rows[0].nulls, 400, "unmeasured likes stay null, measured ones are kept");
  });

  it("the same post twice in one dataset is stored once (last copy wins), without an error", async () => {
    const day = "2026-11-08";
    const p = base.posts[2];
    const dup: AdapterResult = {
      accounts: new Map(base.accounts),
      posts: [
        { ...p, metrics: { ...p.metrics, likes: 1 } },
        { ...p, metrics: { ...p.metrics, likes: 2 } },
      ],
    };
    const summary = await ingest(dup, { actorRunId: "apify-run-dup", targetDate: day });
    assert.deepStrictEqual(summary.errors, []);
    const rows = await snapshot(POST3, day);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].likes, 2);
  });

  it("one bad row does not sink the rest of its batch; it is reported and the run is partial", async () => {
    const day = "2026-11-09";
    const p = base.posts[2];
    const mixed: AdapterResult = {
      accounts: new Map(base.accounts),
      posts: [
        ...Array.from({ length: 5 }, (_, i) => ({ ...p, platform_post_id: `good-${i}`, url: `https://instagram.com/p/good-${i}/` })),
        { ...p, platform_post_id: "bad-0", url: "https://instagram.com/p/bad-0/", posted_at: "not-a-date" },
      ],
    };
    const summary = await ingest(mixed, { actorRunId: "apify-run-mixed", targetDate: day });
    assert.strictEqual(summary.status, "partial");
    assert.strictEqual(summary.errors.length, 1);
    assert.match(summary.errors[0], /bad-0/);
    const good = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM posts WHERE platform_post_id LIKE 'good-%'"
    );
    assert.strictEqual(good.rows[0].n, 5, "the good rows of the same batch are saved");
  });

  it("two overlapping runs of the same data still produce one snapshot per post per day", async () => {
    const day = "2026-11-06";
    const postsBefore = await count("posts");
    await Promise.all([
      ingest(base, { actorRunId: "apify-run-5", targetDate: day }),
      ingest(base, { actorRunId: "apify-run-5", targetDate: day }),
    ]);
    const r = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM post_snapshots WHERE snapshot_date = $1",
      [day]
    );
    assert.strictEqual(r.rows[0].n, 3);
    assert.strictEqual(await count("posts"), postsBefore, "the fixture's posts already exist: no new ones");
  });
});
