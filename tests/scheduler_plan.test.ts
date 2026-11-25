import { describe, it } from "node:test";
import assert from "node:assert";
import {
  DEFAULT_GAP_MINUTES,
  cronFor,
  handleSignature,
  monthSegments,
  planSchedule,
  runMatchesEntry,
  validateScheduleRequest,
  type ScheduleRequest,
} from "../lib/scheduler/plan.ts";
import { buildDiscoveryRunInput } from "../lib/scrapers/discovery-input.ts";

// 10:00 IST on 24 Nov 2026 (04:30 UTC)
const NOW = new Date("2026-11-24T04:30:00Z");

const base: ScheduleRequest = {
  mode: "once",
  startDate: "2026-11-28",
  endDate: "2026-11-28",
  runTime: "09:00",
  platforms: ["instagram", "facebook", "x"],
};

describe("schedule plan", () => {
  it("builds one cron per platform for a single date, staggered", () => {
    const plan = planSchedule(base, NOW);
    assert.deepStrictEqual(
      plan.map((p) => [p.platform, p.cron, p.fireTime]),
      [
        ["instagram", "0 9 28 11 *", "09:00"],
        ["facebook", "10 9 28 11 *", "09:10"],
        ["x", "20 9 28 11 *", "09:20"],
      ]
    );
    assert.strictEqual(DEFAULT_GAP_MINUTES, 10);
  });

  it("splits a range at month boundaries", () => {
    assert.deepStrictEqual(monthSegments("2026-11-25", "2027-01-03"), [
      { start: "2026-11-25", end: "2026-11-30" },
      { start: "2026-12-01", end: "2026-12-31" },
      { start: "2027-01-01", end: "2027-01-03" },
    ]);
    const plan = planSchedule({ ...base, mode: "range", endDate: "2026-12-02", platforms: ["x"] }, NOW);
    assert.deepStrictEqual(
      plan.map((p) => p.cron),
      ["0 9 28-30 11 *", "0 9 1-2 12 *"]
    );
  });

  it("uses a single day, not a range, when a segment is one day", () => {
    assert.strictEqual(cronFor(9 * 60 + 5, "2026-12-31", "2026-12-31"), "5 9 31 12 *");
  });

  it("orders platforms canonically whatever the selection order", () => {
    const plan = planSchedule({ ...base, platforms: ["x", "instagram"] }, NOW);
    assert.deepStrictEqual(plan.map((p) => [p.platform, p.fireTime]), [
      ["instagram", "09:00"],
      ["x", "09:10"],
    ]);
  });

  it("rejects dates in the past and times that already passed today", () => {
    assert.match(validateScheduleRequest({ ...base, startDate: "2026-11-20", endDate: "2026-11-20" }, NOW) ?? "", /past/);
    assert.match(
      validateScheduleRequest({ ...base, startDate: "2026-11-24", endDate: "2026-11-24", runTime: "09:00" }, NOW) ?? "",
      /already passed/
    );
    assert.strictEqual(
      validateScheduleRequest({ ...base, startDate: "2026-11-24", endDate: "2026-11-24", runTime: "10:30" }, NOW),
      null
    );
  });

  it("uses the gap the admin chose, including none", () => {
    const wide = planSchedule({ ...base, gapMinutes: 25 }, NOW);
    assert.deepStrictEqual(wide.map((p) => p.fireTime), ["09:00", "09:25", "09:50"]);
    const same = planSchedule({ ...base, gapMinutes: 0 }, NOW);
    assert.deepStrictEqual(same.map((p) => p.fireTime), ["09:00", "09:00", "09:00"]);
    assert.ok(validateScheduleRequest({ ...base, gapMinutes: -1 }, NOW));
    assert.ok(validateScheduleRequest({ ...base, gapMinutes: 2.5 }, NOW));
    assert.ok(validateScheduleRequest({ ...base, gapMinutes: 121 }, NOW));
    assert.ok(validateScheduleRequest({ ...base, gapMinutes: Number.NaN }, NOW));
    assert.match(validateScheduleRequest({ ...base, runTime: "23:00", gapMinutes: 40 }, NOW) ?? "", /midnight/);
  });

  it("rejects bad input", () => {
    assert.ok(validateScheduleRequest({ ...base, platforms: [] }, NOW));
    assert.ok(validateScheduleRequest({ ...base, startDate: "2026-02-31", endDate: "2026-02-31" }, NOW));
    assert.ok(validateScheduleRequest({ ...base, runTime: "25:00" }, NOW));
    assert.ok(validateScheduleRequest({ ...base, mode: "range", endDate: "2026-11-27" }, NOW));
    assert.ok(validateScheduleRequest({ ...base, mode: "range", endDate: "2027-09-01" }, NOW), "too long");
    assert.ok(validateScheduleRequest({ ...base, startDate: "2028-01-01", endDate: "2028-01-01" }, NOW), "too far ahead");
    // 23:50 + two 10-minute gaps would cross midnight and land on the next date
    assert.match(validateScheduleRequest({ ...base, runTime: "23:50" }, NOW) ?? "", /midnight/);
    assert.strictEqual(validateScheduleRequest({ ...base, runTime: "23:50", platforms: ["instagram"] }, NOW), null);
  });

  it("attributes a run to its planned entry only on the right date and shortly after the time", () => {
    const entry = { fireTime: "09:10", segmentStart: "2026-11-28", segmentEnd: "2026-11-30" };
    // 09:10 IST = 03:40 UTC
    assert.ok(runMatchesEntry(new Date("2026-11-28T03:40:05Z"), entry));
    assert.ok(runMatchesEntry(new Date("2026-11-30T04:00:00Z"), entry)); // 09:30 IST, within grace
    assert.ok(!runMatchesEntry(new Date("2026-11-28T03:30:00Z"), entry)); // 09:00 IST, before
    assert.ok(!runMatchesEntry(new Date("2026-11-28T05:00:00Z"), entry)); // 10:30 IST, too late
    assert.ok(!runMatchesEntry(new Date("2026-12-01T03:40:00Z"), entry)); // after the segment
    assert.ok(!runMatchesEntry(new Date("nonsense"), entry));
  });

  it("matches an IST date that differs from the UTC date", () => {
    // 00:10 IST on 29 Nov = 18:40 UTC on 28 Nov
    const entry = { fireTime: "00:05", segmentStart: "2026-11-29", segmentEnd: "2026-11-29" };
    assert.ok(runMatchesEntry(new Date("2026-11-28T18:40:00Z"), entry));
  });

  it("signature ignores order and duplicates but notices changes", () => {
    assert.strictEqual(handleSignature(["b", "a", "a"]), handleSignature(["a", "b"]));
    assert.notStrictEqual(handleSignature(["a", "b"]), handleSignature(["a", "c"]));
    assert.notStrictEqual(handleSignature(["ab", "c"]), handleSignature(["a", "bc"]));
  });
});

describe("discovery run input", () => {
  it("builds the Instagram input with cleaned handles and no date filter by default", () => {
    const input = buildDiscoveryRunInput("instagram", ["@Asha", " ravi "], { postLimit: 7 });
    assert.deepStrictEqual(input.username, ["asha", "ravi"]);
    assert.deepStrictEqual(input.directUrls, ["https://www.instagram.com/asha/", "https://www.instagram.com/ravi/"]);
    assert.strictEqual(input.resultsLimit, 7);
    assert.ok(!("onlyPostsNewerThan" in input));
    assert.strictEqual(buildDiscoveryRunInput("instagram", ["a"], { onlyPostsNewerThan: "2026-11-23" }).onlyPostsNewerThan, "2026-11-23");
  });

  it("applies the post limit to other platforms", () => {
    const input = buildDiscoveryRunInput("facebook", ["page"], { postLimit: 6 });
    assert.strictEqual(input.resultsLimit, 6);
    assert.strictEqual(input.count, 6);
  });
});
