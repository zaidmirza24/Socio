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

test("a run started 23:50 IST and saved after midnight keeps the posts of the day it started", () => {
  // Run started 2026-11-21 23:50 IST (18:20 UTC); ingestion happens 2026-11-22 00:10 IST.
  const runStartedAt = new Date("2026-11-21T18:20:00.000Z");
  const ingestedAt = new Date("2026-11-21T18:40:00.000Z");
  const posts = [
    { posted_at: "2026-11-21T15:30:00.000Z", account_handle: "a", platform: "instagram" }, // 21:00 IST 21st
    { posted_at: "2026-11-21T04:00:00.000Z", account_handle: "b", platform: "instagram" }, // 09:30 IST 21st
  ];

  // Anchored to ingestion time (the old behaviour) every post looks like "yesterday".
  assert.equal(applyDayWindowAndCap(posts, null, ingestedAt).kept.length, 0);

  // Anchored to the run's start, both are kept.
  const { kept, dropped } = applyDayWindowAndCap(posts, null, runStartedAt);
  assert.equal(kept.length, 2);
  assert.equal(dropped, 0);
});
