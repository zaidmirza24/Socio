import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getIstDayStart,
  getScrapeBoundaryDate,
  isPostedOnIstDay,
  applyDayWindowAndCap,
} from "../lib/utils/day-window.ts";

// 2026-11-21 10:00 IST = 04:30 UTC
const NOW = new Date("2026-11-21T04:30:00.000Z");

test("IST day starts at 00:00 IST (18:30 UTC the day before)", () => {
  assert.equal(getIstDayStart(NOW).toISOString(), "2026-11-20T18:30:00.000Z");
});

test("scrape boundary is the day before today's IST date", () => {
  assert.equal(getScrapeBoundaryDate(NOW), "2026-11-20");
});

test("post at 00:10 IST today counts; 23:50 IST yesterday does not", () => {
  assert.equal(isPostedOnIstDay("2026-11-20T18:40:00.000Z", NOW), true);
  assert.equal(isPostedOnIstDay("2026-11-20T18:20:00.000Z", NOW), false);
  assert.equal(isPostedOnIstDay("2026-11-21T18:29:59.000Z", NOW), true);
  assert.equal(isPostedOnIstDay("2026-11-21T18:30:00.000Z", NOW), false);
});

test("invalid dates are dropped", () => {
  assert.equal(isPostedOnIstDay("not-a-date", NOW), false);
});

test("day window keeps only today and applies per-account cap, newest first", () => {
  const mk = (handle: string, iso: string, id: string) => ({
    platform: "instagram",
    account_handle: handle,
    posted_at: iso,
    id,
  });
  const posts = [
    mk("a", "2026-11-21T03:00:00.000Z", "a1"),
    mk("a", "2026-11-21T02:00:00.000Z", "a2"),
    mk("a", "2026-11-21T01:00:00.000Z", "a3"),
    mk("a", "2026-11-19T01:00:00.000Z", "old"),
    mk("b", "2026-11-21T01:00:00.000Z", "b1"),
  ];
  const { kept, dropped } = applyDayWindowAndCap(posts, 2, NOW);
  assert.deepEqual(kept.map((p) => p.id).sort(), ["a1", "a2", "b1"]);
  assert.equal(dropped, 2);
  const uncapped = applyDayWindowAndCap(posts, null, NOW);
  assert.equal(uncapped.kept.length, 4);
});
