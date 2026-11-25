import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildDayRows,
  summarizeCoverage,
  rowProgress,
  neighbourDays,
  parseDay,
  istDayRange,
  type CoverageAccount,
  type CoverageCaption,
  type CoveragePost,
} from "../lib/coverage/day-coverage.ts";

const captions: CoverageCaption[] = [
  { id: "c1", title: "Caption 1", canonicalCaption: "one", releasedAt: "2026-11-24T04:00:00Z" },
  { id: "c2", title: "Caption 2", canonicalCaption: "two", releasedAt: "2026-11-24T05:00:00Z" },
];

const acct = (
  id: string,
  volunteerId: string | null,
  name: string,
  platform: CoverageAccount["platform"],
  isVisible = true
): CoverageAccount => ({ id, handle: `${name.toLowerCase()}_${platform}`, volunteerName: name, volunteerId, platform, isVisible });

const post = (accountId: string, over: Partial<CoveragePost>): CoveragePost => ({
  accountId,
  url: `https://example.com/${accountId}`,
  matchStatus: "unmatched",
  matchedCaptionId: null,
  matchScore: null,
  bestCaptionId: null,
  postedOnDay: true,
  ...over,
});

const accounts: CoverageAccount[] = [
  acct("a-ig", "v1", "Asha", "instagram"),
  acct("a-fb", "v1", "Asha", "facebook"),
  acct("r-ig", "v2", "Ravi", "instagram"),
  acct("p-ig", "v3", "Priya", "instagram", false),
];

describe("buildDayRows", () => {
  it("groups one volunteer's accounts into one row", () => {
    const rows = buildDayRows(accounts, captions, [], new Map());
    assert.strictEqual(rows.length, 3);
    const asha = rows.find((r) => r.volunteerId === "v1");
    assert.ok(asha && asha.accounts.instagram && asha.accounts.facebook && !asha.accounts.x);
  });

  it("has no cell for a platform the volunteer has no account on (not a miss)", () => {
    const rows = buildDayRows(accounts, captions, [], new Map());
    const ravi = rows.find((r) => r.volunteerId === "v2");
    assert.ok(ravi);
    assert.strictEqual(ravi.cells.c1.facebook, undefined);
    assert.strictEqual(ravi.cells.c1.x, undefined);
    assert.strictEqual(ravi.cells.c1.instagram?.status, "NOT_POSTED");
  });

  it("marks a matched post POSTED with its url", () => {
    const rows = buildDayRows(
      accounts,
      captions,
      [post("a-ig", { matchStatus: "matched", matchedCaptionId: "c1", url: "https://x/1" })],
      new Map()
    );
    const cell = rows.find((r) => r.volunteerId === "v1")?.cells.c1.instagram;
    assert.deepStrictEqual(cell, { status: "POSTED", url: "https://x/1", count: 1 });
    // The other caption is still open for the same account
    assert.strictEqual(rows.find((r) => r.volunteerId === "v1")?.cells.c2.instagram?.status, "NOT_POSTED");
  });

  it("marks a close match NEEDS_REVIEW and links the review item", () => {
    const rows = buildDayRows(
      accounts,
      captions,
      [post("a-fb", { matchStatus: "needs_review", matchedCaptionId: "c2" })],
      new Map([["a-fb:c2", "review-9"]])
    );
    const cell = rows.find((r) => r.volunteerId === "v1")?.cells.c2.facebook;
    assert.deepStrictEqual(cell, { status: "NEEDS_REVIEW", reviewId: "review-9" });
  });

  it("flags 'posted something, nothing matched' instead of calling it not posted", () => {
    const rows = buildDayRows(accounts, captions, [post("r-ig", {})], new Map());
    const ravi = rows.find((r) => r.volunteerId === "v2");
    assert.strictEqual(ravi?.cells.c1.instagram?.status, "POSTED_OTHER");
    assert.strictEqual(ravi?.cells.c1.instagram?.count, 1);
    assert.strictEqual(ravi?.cells.c1.instagram?.nearMiss, false);
  });

  it("marks the caption an unmatched post came close to", () => {
    const rows = buildDayRows(
      accounts,
      captions,
      [post("r-ig", { matchScore: 0.82, bestCaptionId: "c2" })],
      new Map()
    );
    const ravi = rows.find((r) => r.volunteerId === "v2");
    assert.strictEqual(ravi?.cells.c1.instagram?.nearMiss, false);
    assert.strictEqual(ravi?.cells.c2.instagram?.nearMiss, true);
  });

  it("ignores rejected posts and unmatched posts from other days", () => {
    const rows = buildDayRows(
      accounts,
      captions,
      [post("r-ig", { matchStatus: "rejected" }), post("r-ig", { postedOnDay: false })],
      new Map()
    );
    assert.strictEqual(rows.find((r) => r.volunteerId === "v2")?.cells.c1.instagram?.status, "NOT_POSTED");
  });

  it("reports a private account as NO_ACCESS, not as not posted", () => {
    const rows = buildDayRows(accounts, captions, [], new Map());
    assert.strictEqual(rows.find((r) => r.volunteerId === "v3")?.cells.c1.instagram?.status, "NO_ACCESS");
  });

  it("counts several matched posts of one caption once, with the count kept", () => {
    const rows = buildDayRows(
      accounts,
      captions,
      [
        post("a-ig", { matchStatus: "matched", matchedCaptionId: "c1", url: "u1" }),
        post("a-ig", { matchStatus: "matched", matchedCaptionId: "c1", url: "u2" }),
      ],
      new Map()
    );
    const cell = rows.find((r) => r.volunteerId === "v1")?.cells.c1.instagram;
    assert.strictEqual(cell?.status, "POSTED");
    assert.strictEqual(cell?.count, 2);
  });

  it("keeps a second account of the same platform on its own row", () => {
    const rows = buildDayRows([...accounts, acct("a-ig2", "v1", "Asha", "instagram")], captions, [], new Map());
    assert.strictEqual(rows.filter((r) => r.name === "Asha").length, 2);
  });

  it("is deterministic: running twice gives the same rows", () => {
    const input = [post("a-ig", { matchStatus: "matched", matchedCaptionId: "c1" })];
    assert.deepStrictEqual(
      buildDayRows(accounts, captions, input, new Map()),
      buildDayRows(accounts, captions, input, new Map())
    );
  });
});

describe("summarizeCoverage / rowProgress", () => {
  const rows = buildDayRows(
    accounts,
    captions,
    [
      post("a-ig", { matchStatus: "matched", matchedCaptionId: "c1" }),
      post("a-fb", { matchStatus: "matched", matchedCaptionId: "c1" }),
      post("r-ig", { matchStatus: "needs_review", matchedCaptionId: "c2" }),
    ],
    new Map()
  );

  it("expects only cells where an account exists", () => {
    const s = summarizeCoverage(rows, captions);
    // IG accounts: Asha, Ravi, Priya = 3 x 2 captions; FB: Asha = 1 x 2; X: none
    assert.deepStrictEqual(s.byPlatform.instagram, { expected: 6, posted: 1 });
    assert.deepStrictEqual(s.byPlatform.facebook, { expected: 2, posted: 1 });
    assert.deepStrictEqual(s.byPlatform.x, { expected: 0, posted: 0 });
    assert.deepStrictEqual(s.overall, { expected: 8, posted: 2 });
  });

  it("counts every status and per caption", () => {
    const s = summarizeCoverage(rows, captions);
    assert.strictEqual(s.counts.NEEDS_REVIEW, 1);
    assert.strictEqual(s.counts.NO_ACCESS, 2);
    assert.deepStrictEqual(s.byCaption.c1, { expected: 4, posted: 2 });
  });

  it("respects a platform filter", () => {
    const s = summarizeCoverage(rows, captions, ["facebook"]);
    assert.deepStrictEqual(s.overall, { expected: 2, posted: 1 });
  });

  it("rowProgress is posted out of applicable cells", () => {
    const asha = rows.find((r) => r.volunteerId === "v1");
    assert.ok(asha);
    assert.deepStrictEqual(rowProgress(asha, captions), { expected: 4, posted: 2 });
    assert.deepStrictEqual(rowProgress(asha, captions, ["facebook"]), { expected: 2, posted: 1 });
  });
});

describe("day helpers", () => {
  it("finds the previous and next day that has captions", () => {
    const days = ["2026-11-20", "2026-11-22", "2026-11-25"];
    assert.deepStrictEqual(neighbourDays(days, "2026-11-22"), { prev: "2026-11-20", next: "2026-11-25" });
    assert.deepStrictEqual(neighbourDays(days, "2026-11-23"), { prev: "2026-11-22", next: "2026-11-25" });
    assert.deepStrictEqual(neighbourDays(days, "2026-11-20"), { prev: null, next: "2026-11-22" });
    assert.deepStrictEqual(neighbourDays([], "2026-11-20"), { prev: null, next: null });
  });

  it("parseDay accepts real dates only", () => {
    assert.strictEqual(parseDay("2026-11-24"), "2026-11-24");
    assert.strictEqual(parseDay("2026-02-30"), null);
    assert.strictEqual(parseDay("24-11-2026"), null);
    assert.strictEqual(parseDay(undefined), null);
  });

  it("istDayRange spans the IST calendar day", () => {
    assert.deepStrictEqual(istDayRange("2026-11-24"), {
      start: "2026-11-23T18:30:00.000Z",
      end: "2026-11-24T18:30:00.000Z",
    });
  });
});
