import { describe, it } from "node:test";
import assert from "node:assert";
import { matchCaption, describeMatch, type MatchableCaption } from "../lib/matching/matcher.ts";
import { normalizeCaption, computeCaptionHash } from "../lib/matching/normalizer.ts";

/**
 * Tier 1D ("tier1_core"): the volunteer wrapped the campaign text in a greeting / hashtags /
 * sign-off but the core text is identical. That must auto-match instead of filling the review
 * queue, but only when it is unambiguous, same-day and the core is long enough to mean something.
 */

const CORE = "Plant a tree today and save our planet for the next generation";

const caption = (id: string, text: string, releasedAt = "2026-11-24T04:00:00Z"): MatchableCaption => ({
  id,
  canonical_caption: text,
  normalized_caption: normalizeCaption(text),
  caption_hash: computeCaptionHash(normalizeCaption(text)),
  released_at: releasedAt,
});

const sameDay = { postedAt: "2026-11-24T08:00:00Z", sameDayOnly: true };

describe("Tier 1D - identical core text, extra greeting / hashtags / sign-off", () => {
  const caps = [caption("c1", CORE)];

  const wrapped: Array<[string, string]> = [
    ["greeting + trailing hashtags (multi-line)", `Namaste friends!\n${CORE}\n#GreenIndia #Mumbai`],
    ["single-line greeting", `Namaste friends! ${CORE}`],
    ["trailing inline hashtags", `${CORE} #GreenIndia #SaveEarth #Mumbai`],
    ["Hindi greeting", `नमस्ते साथियों!\n${CORE}`],
    ["sign-off line", `${CORE}\nRegards, Asha`],
    ["greeting, hashtags and sign-off together", `Hello everyone,\n${CORE}\n#Green\nThanks`],
    ["punctuation changed inside the core", `Namaste!\nPlant a tree today, and save our planet for the next generation!\n#tree`],
  ];

  for (const [label, text] of wrapped) {
    it(`auto-matches: ${label}`, () => {
      const r = matchCaption(text, caps, [], sameDay);
      assert.ok(r.matched, "should match");
      assert.strictEqual(r.needsReview, false, "must not need review");
      assert.strictEqual(r.tier, "tier1_core");
      assert.strictEqual(r.captionId, "c1");
      assert.strictEqual(describeMatch(r).reason, "core");
    });
  }

  it("still reports a word-for-word match as tier1_exact (1D never steals it)", () => {
    const r = matchCaption(CORE, caps, [], sameDay);
    assert.ok(r.matched && r.tier === "tier1_exact");
  });

  it("does NOT auto-match when the volunteer changed a word in the core text", () => {
    const r = matchCaption(`Namaste!\nPlant a tree today and save our earth for the next generation\n#tree`, caps, [], sameDay);
    assert.ok(!r.matched || r.tier !== "tier1_core");
  });

  it("does NOT auto-match when the volunteer added a sentence inside the core text", () => {
    const r = matchCaption(
      `Plant a tree today and save our planet. I did it with my family yesterday. for the next generation`,
      caps,
      [],
      sameDay
    );
    assert.ok(!r.matched || r.tier !== "tier1_core");
  });
});

describe("Tier 1D - guards", () => {
  it("sends it to review when two captions of the day have the same core (ambiguous)", () => {
    const caps = [caption("c1", `${CORE} #one`), caption("c2", `Namaste!\n${CORE}\n#two`)];
    const r = matchCaption(`Hello!\n${CORE}\n#three`, caps, [], sameDay);
    assert.ok(!r.matched || r.tier !== "tier1_core", "an ambiguous core must not auto-match");
  });

  it("does not auto-match a caption that is mostly hashtags / too short", () => {
    const caps = [caption("c1", "Join us! #green #india #tree")];
    const r = matchCaption("Hello!\nJoin us!\n#something #else", caps, [], sameDay);
    assert.ok(!r.matched || r.tier !== "tier1_core");
  });

  it("a neighbouring-day caption is never auto-accepted, even for identical core text", () => {
    const caps = [caption("c1", CORE, "2026-11-23T04:00:00Z")]; // released the day before the post
    const r = matchCaption(`Namaste!\n${CORE}\n#tree`, caps, [], sameDay);
    assert.ok(r.matched, "still found via the day window");
    assert.strictEqual(r.needsReview, true);
    assert.strictEqual(r.adjacentDayOffset, -1);
  });

  it("keeps the strict URL rule: a different link means no auto-match", () => {
    const withLink = `${CORE} https://example.org/join`;
    const caps = [caption("c1", withLink)];
    const r = matchCaption(`Namaste!\n${CORE} https://evil.example.com/other\n#tree`, caps, [], sameDay);
    assert.ok(!r.matched || r.tier !== "tier1_core");
  });

  it("auto-matches when the link is identical", () => {
    const withLink = `${CORE} https://example.org/join`;
    const caps = [caption("c1", withLink)];
    const r = matchCaption(`Namaste!\n${CORE} https://example.org/join\n#tree`, caps, [], sameDay);
    assert.ok(r.matched && r.tier === "tier1_core" && !r.needsReview);
  });

  it("is deterministic", () => {
    const caps = [caption("c1", CORE)];
    const text = `Namaste!\n${CORE}\n#tree`;
    assert.deepStrictEqual(matchCaption(text, caps, [], sameDay), matchCaption(text, caps, [], sameDay));
  });
});
