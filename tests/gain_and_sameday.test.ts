import { describe, it } from "node:test";
import assert from "node:assert";
import { computeDailyGains, computePostGains, sumGain, type SnapshotPoint } from "../lib/metrics/gain.ts";
import { matchCaption, calendarDay, type MatchableCaption } from "../lib/matching/matcher.ts";
import { normalizeCaption, computeCaptionHash } from "../lib/matching/normalizer.ts";

const snap = (
  post_id: string,
  snapshot_date: string,
  likes: number | null,
  comments: number | null = 0,
  views: number | null = null
): SnapshotPoint => ({ post_id, snapshot_date, likes, comments, views });

describe("Gain over the period", () => {
  it("measures growth against the last snapshot before the period", () => {
    const points = [snap("a", "2026-11-10", 100), snap("a", "2026-11-18", 130), snap("a", "2026-11-20", 150)];
    const gains = computePostGains(points, "2026-11-15");
    assert.strictEqual(gains.get("a")?.likes, 50); // 150 - 100
  });

  it("counts a brand-new post entirely as gain", () => {
    const gains = computePostGains([snap("new", "2026-11-20", 40, 5)], "2026-11-20");
    assert.strictEqual(gains.get("new")?.likes, 40);
    assert.strictEqual(gains.get("new")?.comments, 5);
  });

  it("skips posts with no snapshot in the period", () => {
    const gains = computePostGains([snap("old", "2026-10-01", 10)], "2026-11-01");
    assert.strictEqual(gains.size, 0);
  });

  it("never goes negative when likes drop", () => {
    const gains = computePostGains([snap("a", "2026-11-10", 100), snap("a", "2026-11-20", 90)], "2026-11-15");
    assert.strictEqual(gains.get("a")?.likes, 0);
  });

  it("keeps unmeasured metrics as null instead of 0", () => {
    const gains = computePostGains([snap("a", "2026-11-20", 10, 1, null)], "2026-11-20");
    assert.strictEqual(gains.get("a")?.views, null);
    assert.strictEqual(sumGain([gains.get("a")!.views, null]), 0);
  });

  it("all-time (since = null) equals the latest totals", () => {
    const gains = computePostGains([snap("a", "2026-11-10", 100), snap("a", "2026-11-20", 150)], null);
    assert.strictEqual(gains.get("a")?.likes, 150);
  });

  it("daily gains give each day's growth", () => {
    const points = [snap("a", "2026-11-18", 10), snap("a", "2026-11-19", 25), snap("a", "2026-11-20", 40)];
    const daily = computeDailyGains(points, "2026-11-19");
    assert.deepStrictEqual(
      daily.map((d) => [d.date, d.likes]),
      [["2026-11-19", 15], ["2026-11-20", 15]]
    );
  });
});

describe("Same-day caption matching", () => {
  const text = "Join our plantation drive today and plant a tree for the future!";
  const caption = (id: string, releasedAt: string): MatchableCaption => ({
    id,
    canonical_caption: text,
    normalized_caption: normalizeCaption(text),
    caption_hash: computeCaptionHash(normalizeCaption(text)),
    released_at: releasedAt,
  });
  const opts = (postedAt: string) => ({ postedAt, sameDayOnly: true });

  it("matches a post published the same IST day as the caption release", () => {
    const r = matchCaption(text, [caption("c1", "2026-11-20T04:00:00Z")], [], opts("2026-11-20T10:00:00Z"));
    assert.ok(r.matched);
  });

  it("rejects a post from the next day", () => {
    const r = matchCaption(text, [caption("c1", "2026-11-20T04:00:00Z")], [], opts("2026-11-21T04:00:00Z"));
    assert.ok(!r.matched && r.reason === "outside_embargo_window");
  });

  it("rejects a post from the day before", () => {
    const r = matchCaption(text, [caption("c1", "2026-11-20T04:00:00Z")], [], opts("2026-11-19T04:00:00Z"));
    assert.ok(!r.matched && r.reason === "outside_embargo_window");
  });

  it("picks the caption of the post's own day when several days are active", () => {
    const r = matchCaption(
      text,
      [caption("day1", "2026-11-19T04:00:00Z"), caption("day2", "2026-11-20T04:00:00Z")],
      [],
      opts("2026-11-20T08:00:00Z")
    );
    assert.ok(r.matched && r.captionId === "day2");
  });

  it("uses the IST calendar day, not UTC", () => {
    // 20:00 UTC on the 20th is already 01:30 IST on the 21st
    assert.strictEqual(calendarDay("2026-11-20T20:00:00Z"), "2026-11-21");
    assert.strictEqual(calendarDay("2026-11-20T04:00:00Z"), "2026-11-20");
  });
});
