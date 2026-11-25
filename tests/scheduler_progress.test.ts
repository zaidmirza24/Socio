import { describe, it } from "node:test";
import assert from "node:assert";
import { buildProgress, classifyRun, expectedRuns, type RecordedRun } from "../lib/scheduler/progress.ts";

const entries = [
  { platform: "instagram" as const, fireTime: "09:00", segmentStart: "2026-11-28", segmentEnd: "2026-12-01" },
  { platform: "x" as const, fireTime: "09:10", segmentStart: "2026-11-28", segmentEnd: "2026-12-01" },
];

const run = (over: Partial<RecordedRun>): RecordedRun => ({
  runId: "r1",
  platform: "instagram",
  status: "success",
  startedAt: "2026-11-28T03:30:10Z", // 09:00:10 IST on 28 Nov
  completedAt: "2026-11-28T03:40:00Z",
  accountsTargeted: 100,
  postsUpserted: 42,
  snapshotsCreated: 42,
  error: null,
  ...over,
});

describe("expected runs", () => {
  it("lists one run per platform per day, in time order", () => {
    const e = expectedRuns(entries);
    assert.strictEqual(e.length, 8);
    assert.deepStrictEqual(e.slice(0, 2).map((r) => [r.date, r.platform, r.fireTime]), [
      ["2026-11-28", "instagram", "09:00"],
      ["2026-11-28", "x", "09:10"],
    ]);
  });
  it("does not double count overlapping segments", () => {
    const e = expectedRuns([entries[0], { ...entries[0] }]);
    assert.strictEqual(e.length, 4);
  });
});

describe("classifyRun", () => {
  const exp = { date: "2026-11-28", platform: "instagram" as const, fireTime: "09:00" };
  const at = (iso: string) => new Date(iso);
  it("walks upcoming -> due -> missed when no run ever shows up", () => {
    assert.strictEqual(classifyRun(exp, null, "active", at("2026-11-28T03:00:00Z")), "upcoming"); // 08:30 IST
    assert.strictEqual(classifyRun(exp, null, "active", at("2026-11-28T03:40:00Z")), "due"); // 09:10 IST
    assert.strictEqual(classifyRun(exp, null, "active", at("2026-11-28T05:00:00Z")), "missed"); // 10:30 IST
  });
  it("reports paused instead of missed", () => {
    assert.strictEqual(classifyRun(exp, null, "paused", at("2026-11-29T00:00:00Z")), "paused");
  });
  it("maps recorded statuses", () => {
    const now = at("2026-11-28T06:00:00Z");
    assert.strictEqual(classifyRun(exp, run({ status: "started" }), "active", now), "running");
    assert.strictEqual(classifyRun(exp, run({ status: "ingesting" }), "active", now), "saving");
    assert.strictEqual(classifyRun(exp, run({ status: "success" }), "active", now), "saved");
    assert.strictEqual(classifyRun(exp, run({ status: "partial" }), "active", now), "partial");
    assert.strictEqual(classifyRun(exp, run({ status: "failed" }), "active", now), "failed");
  });
});

describe("buildProgress", () => {
  it("counts totals and finishes only when nothing is pending", () => {
    const expected = expectedRuns(entries.map((e) => ({ ...e, segmentEnd: "2026-11-28" })));
    const now = new Date("2026-11-28T03:50:00Z"); // 09:20 IST
    const mid = buildProgress(expected, [run({})], "active", now);
    assert.strictEqual(mid.totals.planned, 2);
    assert.strictEqual(mid.totals.saved, 1);
    assert.strictEqual(mid.totals.inProgress, 1); // x is due, not seen yet
    assert.strictEqual(mid.totals.finished, false);

    const done = buildProgress(
      expected,
      [run({}), run({ platform: "x", status: "failed", startedAt: "2026-11-28T03:41:00Z", error: "boom" })],
      "active",
      now
    );
    assert.deepStrictEqual(
      [done.totals.saved, done.totals.failed, done.totals.finished],
      [1, 1, true]
    );
  });

  it("assigns a run to its IST day even when the UTC date differs", () => {
    const expected = expectedRuns([
      { platform: "instagram", fireTime: "00:05", segmentStart: "2026-11-29", segmentEnd: "2026-11-29" },
    ]);
    // 00:06 IST on 29 Nov = 18:36 UTC on 28 Nov
    const p = buildProgress(expected, [run({ startedAt: "2026-11-28T18:36:00Z" })], "active", new Date("2026-11-29T01:00:00Z"));
    assert.strictEqual(p.days[0].runs[0].state, "saved");
  });

  it("keeps the latest run when a day has two", () => {
    const expected = expectedRuns([entries[0]].map((e) => ({ ...e, segmentEnd: "2026-11-28" })));
    const p = buildProgress(
      expected,
      [run({ status: "failed", startedAt: "2026-11-28T03:30:00Z" }), run({ status: "success", startedAt: "2026-11-28T04:00:00Z" })],
      "active",
      new Date("2026-11-28T06:00:00Z")
    );
    assert.strictEqual(p.days[0].runs[0].state, "saved");
  });
});
