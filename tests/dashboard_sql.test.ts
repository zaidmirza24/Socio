/**
 * The dashboard's gain math lives in SQL (supabase/migrations/20261207_dashboard_gain_functions.sql)
 * and, as the reference / fallback, in lib/metrics/gain.ts. This test runs the real migration on a
 * real Postgres (PGlite, in-process) and checks both give the same numbers on seeded random data:
 * missing measurements, likes that drop, several platforms, accounts with and without volunteers.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { computeDailyGains, computePostGains, sumGain, type SnapshotPoint } from "../lib/metrics/gain.ts";

// ---------------------------------------------------------------------------
// Seeded data
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261127);
const int = (n: number) => Math.floor(rand() * n);
let uuidCounter = 0;
const uuid = () => `00000000-0000-4000-8000-${(++uuidCounter).toString(16).padStart(12, "0")}`;

interface Account { id: string; platform: string; handle: string; volunteer_name: string; volunteer_id: string | null }
interface Post { id: string; account_id: string; caption: string }

const PLATFORMS = ["instagram", "facebook", "x"];
const volunteers = Array.from({ length: 5 }, (_, i) => ({ id: uuid(), name: `Volunteer ${i}` }));
const accounts: Account[] = Array.from({ length: 14 }, (_, i) => {
  const vol = i % 4 === 3 ? null : volunteers[i % volunteers.length]; // some accounts have no volunteer
  return {
    id: uuid(),
    platform: PLATFORMS[i % 3],
    handle: `handle_${i}`,
    volunteer_name: vol ? vol.name : `Solo ${i}`,
    volunteer_id: vol ? vol.id : null,
  };
});
const posts: Post[] = Array.from({ length: 80 }, (_, i) => ({
  id: uuid(),
  account_id: accounts[int(accounts.length)].id,
  caption: `caption ${i}`,
}));

const DAYS = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

const snapshots: SnapshotPoint[] = [];
for (const p of posts) {
  const first = int(DAYS.length);
  let likes = int(50);
  let comments = int(10);
  let views = int(500);
  const viewsNeverMeasured = rand() < 0.2;
  for (let d = first; d < DAYS.length; d++) {
    if (rand() < 0.35) continue; // not every day is scraped (weekly refresh)
    likes = Math.max(0, likes + int(40) - (rand() < 0.15 ? 60 : 0)); // sometimes people un-like
    comments = Math.max(0, comments + int(6) - (rand() < 0.1 ? 8 : 0));
    views += int(300);
    snapshots.push({
      post_id: p.id,
      snapshot_date: DAYS[d],
      likes: rand() < 0.2 ? null : likes, // hidden / not measured
      comments: rand() < 0.15 ? null : comments,
      views: viewsNeverMeasured || rand() < 0.25 ? null : views,
    });
  }
}

// ---------------------------------------------------------------------------
// Reference (JavaScript) results
// ---------------------------------------------------------------------------

const accountById = new Map(accounts.map((a) => [a.id, a]));
const postById = new Map(posts.map((p) => [p.id, p]));
const accountOfPost = (postId: string) => accountById.get(postById.get(postId)!.account_id)!;
const platformOk = (a: Account, platform: string) => platform === "all" || a.platform === platform;

function expectedAccountGains(since: string | null, platform: string) {
  const out = new Map<string, { posts: number; likes: number; comments: number; views: number }>();
  for (const [postId, g] of computePostGains(snapshots, since)) {
    const a = accountOfPost(postId);
    if (!platformOk(a, platform)) continue;
    const e = out.get(a.id) ?? { posts: 0, likes: 0, comments: 0, views: 0 };
    e.posts += 1;
    e.likes += sumGain([g.likes]);
    e.comments += sumGain([g.comments]);
    e.views += sumGain([g.views]);
    out.set(a.id, e);
  }
  return out;
}

function expectedTopEngagements(since: string | null, platform: string): number[] {
  const values: number[] = [];
  for (const [postId, g] of computePostGains(snapshots, since)) {
    if (!platformOk(accountOfPost(postId), platform)) continue;
    values.push(sumGain([g.likes]) + sumGain([g.comments]));
  }
  return values.sort((a, b) => b - a).slice(0, 10);
}

function expectedDaily(since: string | null, platform: string) {
  const trend = new Map<string, { likes: number; comments: number }>();
  const perVolunteer = new Map<string, Map<string, { name: string; engagement: number }>>();
  for (const d of computeDailyGains(snapshots, since)) {
    const a = accountOfPost(d.postId);
    if (!platformOk(a, platform)) continue;
    const t = trend.get(d.date) ?? { likes: 0, comments: 0 };
    t.likes += sumGain([d.likes]);
    t.comments += sumGain([d.comments]);
    trend.set(d.date, t);

    const key = a.volunteer_id ?? `acct:${a.id}`;
    const day = perVolunteer.get(d.date) ?? new Map<string, { name: string; engagement: number }>();
    const v = day.get(key) ?? { name: a.volunteer_name, engagement: 0 };
    v.engagement += sumGain([d.likes]) + sumGain([d.comments]);
    day.set(key, v);
    perVolunteer.set(d.date, day);
  }
  return { trend, perVolunteer };
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE accounts (
      id UUID PRIMARY KEY, platform TEXT NOT NULL, handle TEXT NOT NULL,
      volunteer_name TEXT NOT NULL, volunteer_id UUID
    );
    CREATE TABLE posts (id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES accounts(id), caption TEXT);
    CREATE TABLE post_snapshots (
      post_id UUID NOT NULL REFERENCES posts(id), snapshot_date DATE NOT NULL,
      likes INTEGER, comments INTEGER, views INTEGER,
      UNIQUE (post_id, snapshot_date)
    );
  `);
  for (const a of accounts) {
    await db.query(
      "INSERT INTO accounts (id, platform, handle, volunteer_name, volunteer_id) VALUES ($1,$2,$3,$4,$5)",
      [a.id, a.platform, a.handle, a.volunteer_name, a.volunteer_id]
    );
  }
  for (const p of posts) {
    await db.query("INSERT INTO posts (id, account_id, caption) VALUES ($1,$2,$3)", [p.id, p.account_id, p.caption]);
  }
  for (const s of snapshots) {
    await db.query(
      "INSERT INTO post_snapshots (post_id, snapshot_date, likes, comments, views) VALUES ($1,$2,$3,$4,$5)",
      [s.post_id, s.snapshot_date, s.likes, s.comments, s.views]
    );
  }
  const migration = readFileSync(
    new URL("../supabase/migrations/20261207_dashboard_gain_functions.sql", import.meta.url),
    "utf8"
  );
  await db.exec(migration);
});

after(async () => {
  await db.close();
});

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// since = null (all time), the very first day, the middle, the last day, and a day with no data.
const SINCE_CASES: Array<string | null> = [null, "2026-10-01", "2026-10-08", "2026-10-15", "2026-10-20", "2026-10-25"];
const PLATFORM_CASES = ["all", ...PLATFORMS];

describe("dashboard SQL gain functions match lib/metrics/gain.ts", () => {
  it("generated enough varied data to be meaningful", () => {
    assert.ok(snapshots.length > 300, `only ${snapshots.length} snapshots`);
    assert.ok(snapshots.some((s) => s.likes === null), "needs unmeasured likes");
    const drops = snapshots.some((s, i) => {
      const prev = snapshots[i - 1];
      return prev && prev.post_id === s.post_id && prev.likes !== null && s.likes !== null && s.likes < prev.likes;
    });
    assert.ok(drops, "needs likes that drop");
  });

  for (const since of SINCE_CASES) {
    for (const platform of PLATFORM_CASES) {
      const label = `since=${since ?? "all-time"} platform=${platform}`;

      it(`account gains (${label})`, async () => {
        const expected = expectedAccountGains(since, platform);
        const { rows } = await db.query<Record<string, unknown>>(
          "SELECT * FROM dashboard_account_gains($1, $2)",
          [since, platform]
        );
        assert.strictEqual(rows.length, expected.size, "number of accounts with activity");
        for (const r of rows) {
          const e = expected.get(r.account_id as string);
          assert.ok(e, `unexpected account ${String(r.account_id)}`);
          assert.deepStrictEqual(
            { posts: num(r.posts), likes: num(r.likes), comments: num(r.comments), views: num(r.views) },
            e,
            `account ${String(r.handle)}`
          );
        }
      });

      it(`top posts (${label})`, async () => {
        const { rows } = await db.query<Record<string, unknown>>(
          "SELECT * FROM dashboard_top_posts($1, $2, 10)",
          [since, platform]
        );
        const actual = rows.map((r) => Number(r.likes) + Number(r.comments));
        assert.deepStrictEqual(actual, expectedTopEngagements(since, platform));
      });

      it(`daily trend and best volunteer (${label})`, async () => {
        const { trend, perVolunteer } = expectedDaily(since, platform);

        const trendRows = (
          await db.query<Record<string, unknown>>(
            "SELECT to_char(day, 'YYYY-MM-DD') AS day, likes, comments FROM dashboard_daily_trend($1, $2)",
            [since, platform]
          )
        ).rows;
        const expectedTrend = Array.from(trend.entries())
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([day, v]) => ({ day, likes: v.likes, comments: v.comments }));
        assert.deepStrictEqual(
          trendRows.map((r) => ({ day: r.day, likes: num(r.likes), comments: num(r.comments) })),
          expectedTrend
        );

        const bestRows = (
          await db.query<Record<string, unknown>>(
            "SELECT to_char(day, 'YYYY-MM-DD') AS day, volunteer_name, engagement FROM dashboard_daily_top_volunteer($1, $2)",
            [since, platform]
          )
        ).rows;
        assert.strictEqual(bestRows.length, perVolunteer.size, "one row per day");
        for (const r of bestRows) {
          const day = perVolunteer.get(r.day as string)!;
          const values = Array.from(day.values());
          const max = Math.max(0, ...values.map((v) => v.engagement));
          assert.strictEqual(num(r.engagement), max, `best engagement on ${String(r.day)}`);
          const leaders = values.filter((v) => v.engagement === max && max > 0).map((v) => v.name);
          if (max === 0) assert.strictEqual(r.volunteer_name, "-");
          else assert.ok(leaders.includes(r.volunteer_name as string), `leader on ${String(r.day)}`);
        }
      });
    }
  }
});
