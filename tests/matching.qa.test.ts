/**
 * QA Validation Suite: Caption Matching & Filtering Engine
 *
 * Senior QA Automation Engineer validation of the two-tier caption matching
 * pipeline. Tests cover the complete spectrum of edge cases for a system that
 * performs EXACT CAPTION MATCHING (Tier 1) with fuzzy fallback for review (Tier 2).
 *
 * Run: node --no-warnings --experimental-strip-types tests/matching.qa.test.ts
 */

import {
  normalizeCaption,
  computeCaptionHash,
  processCaption,
  segmentCaption,
  countWords,
} from "../lib/matching/normalizer.ts";
import {
  matchCaption,
  computeCaptionSimilarity,
  calculateTokenSimilarity,
  jaroSimilarity,
  jaroWinklerSimilarity,
  getAdaptiveThreshold,
  type MatchableCaption,
  type MatchableVariant,
  type MatchResult,
  FUZZY_SIMILARITY_THRESHOLD,
} from "../lib/matching/matcher.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Test Harness
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  note?: string;
  isFalsePositive?: boolean;
  isFalseNegative?: boolean;
  bugSeverity?: "critical" | "high" | "medium" | "low";
}

const results: TestResult[] = [];
let currentCategory = "";

function setCategory(cat: string): void {
  currentCategory = cat;
}

function test(
  id: string,
  name: string,
  fn: () => { expected: string; actual: string; pass: boolean; note?: string; fp?: boolean; fn_?: boolean; severity?: "critical" | "high" | "medium" | "low" }
): void {
  try {
    const r = fn();
    results.push({
      id,
      name,
      category: currentCategory,
      passed: r.pass,
      input: name,
      expected: r.expected,
      actual: r.actual,
      note: r.note,
      isFalsePositive: r.fp,
      isFalseNegative: r.fn_,
      bugSeverity: r.pass ? undefined : r.severity ?? "high",
    });
    if (!r.pass) {
      console.error(`  ✗ [${id}] ${name}`);
      console.error(`       Expected: ${r.expected}`);
      console.error(`       Actual:   ${r.actual}`);
      if (r.note) console.error(`       Note:     ${r.note}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id,
      name,
      category: currentCategory,
      passed: false,
      input: name,
      expected: "no exception",
      actual: `THREW: ${msg}`,
      bugSeverity: "critical",
    });
    console.error(`  ✗ [${id}] ${name} — EXCEPTION: ${msg}`);
  }
}

function passed(expected: string, actual: string, note?: string) {
  return { expected, actual, pass: true, note };
}
function failed(expected: string, actual: string, note?: string, fp?: boolean, fn_?: boolean, severity?: "critical" | "high" | "medium" | "low") {
  return { expected, actual, pass: false, note, fp, fn_, severity };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CANONICAL_SHORT = "Plant trees today.";
const CANONICAL_MEDIUM =
  "Join us this Sunday for our Annual Tree Planting Drive! Bring gloves and water bottles.";
const CANONICAL_LONG =
  "We are proud to announce our nationwide afforestation campaign for 2026. Every citizen has a vital role to play in preserving our ecosystem and planting native trees.\n\nJoin our volunteer chapter this Saturday at 8:00 AM at the city central grounds. Bring reusable water bottles, comfortable walking shoes, and gloves. Refreshments and saplings will be provided on-site.\n\nTogether we can build a greener tomorrow. For questions contact volunteer helpline at 9876543210.";

function makeCaptions(entries: { id: string; raw: string; released_at?: string }[]): MatchableCaption[] {
  return entries.map((e) => {
    const { normalized, hash } = processCaption(e.raw);
    return {
      id: e.id,
      canonical_caption: e.raw,
      normalized_caption: normalized,
      caption_hash: hash,
      released_at: e.released_at ?? null,
    };
  });
}

const ACTIVE_SHORT = makeCaptions([{ id: "cap-short", raw: CANONICAL_SHORT }]);
const ACTIVE_MEDIUM = makeCaptions([{ id: "cap-medium", raw: CANONICAL_MEDIUM }]);
const ACTIVE_LONG = makeCaptions([{ id: "cap-long", raw: CANONICAL_LONG }]);

function describeResult(r: MatchResult): string {
  if (!r.matched) return `NO_MATCH(${r.reason})`;
  if (r.tier === "tier1_exact") return `TIER1_EXACT(id=${r.captionId}, conf=1.0)`;
  if (r.tier === "manual_approved") return `APPROVED_VARIANT(id=${r.captionId})`;
  return `TIER2_FUZZY(id=${r.captionId}, conf=${r.confidence}, review=${r.needsReview})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Normalizer Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Normalizer");

test("N-01", "Exact same text normalizes to itself (round-trip)", () => {
  const input = "join us this sunday for our annual tree planting drive! bring gloves and water bottles.";
  const out = normalizeCaption(input);
  return out === input
    ? passed(input, out)
    : failed(input, out, "Already-normalized text must be stable", false, false, "medium");
});

test("N-02", "Leading and trailing whitespace stripped", () => {
  const out = normalizeCaption("   hello world   ");
  const exp = "hello world";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-03", "Multiple internal spaces collapsed to single space", () => {
  const out = normalizeCaption("hello   world");
  const exp = "hello world";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-04", "CRLF and CR line breaks normalized to LF", () => {
  const out = normalizeCaption("line1\r\nline2\rline3");
  const exp = "line1\nline2\nline3";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-05", "Three or more consecutive newlines collapsed to two", () => {
  const out = normalizeCaption("a\n\n\n\nb");
  const exp = "a\n\nb";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-06", "Uppercase folded to lowercase", () => {
  const out = normalizeCaption("PLANT TREES TODAY");
  const exp = "plant trees today";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "critical");
});

test("N-07", "Typographic curly double quotes → ASCII", () => {
  const out = normalizeCaption("\u201CHello World\u201D");
  const exp = '"hello world"';
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-08", "Smart apostrophe → ASCII apostrophe", () => {
  const out = normalizeCaption("it\u2019s a great day");
  const exp = "it's a great day";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-09", "Em-dash → ASCII hyphen", () => {
  const out = normalizeCaption("action \u2014 not words");
  const exp = "action - not words";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-10", "Bullet marker → ASCII asterisk", () => {
  const out = normalizeCaption("\u2022 point one");
  const exp = "* point one";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "low");
});

test("N-11", "Platform truncation '... more' stripped", () => {
  const out = normalizeCaption("Read the full statement... more");
  const exp = "read the full statement";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-12", "Unicode ellipsis '…' stripped at end", () => {
  const out = normalizeCaption("This is an update\u2026");
  const exp = "this is an update";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-13", "HTTP URL replaced with {{url}} placeholder", () => {
  const out = normalizeCaption("Register at https://example.com/signup today");
  const exp = "register at {{url}} today";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-14", "URL trailing punctuation (period) preserved outside {{url}}", () => {
  const out = normalizeCaption("Visit https://example.com.");
  const exp = "visit {{url}}.";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-15", "Zero-width space (U+200B) stripped", () => {
  const out = normalizeCaption("hello\u200Bworld");
  const exp = "helloworld";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-16", "BOM (U+FEFF) stripped", () => {
  const out = normalizeCaption("\uFEFFhello");
  const exp = "hello";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-17", "Soft hyphen (U+00AD) stripped", () => {
  const out = normalizeCaption("vol\u00ADunteer");
  const exp = "volunteer";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "low");
});

test("N-18", "Null input returns empty string (no crash)", () => {
  const out = normalizeCaption(null);
  return out === "" ? passed("\"\"", out) : failed("\"\"", out, undefined, false, false, "critical");
});

test("N-19", "Undefined input returns empty string (no crash)", () => {
  const out = normalizeCaption(undefined);
  return out === "" ? passed("\"\"", out) : failed("\"\"", out, undefined, false, false, "critical");
});

test("N-20", "Empty string input returns empty string", () => {
  const out = normalizeCaption("");
  return out === "" ? passed("\"\"", out) : failed("\"\"", out, undefined, false, false, "critical");
});

test("N-21", "Whitespace-only string returns empty string", () => {
  const out = normalizeCaption("   \t  ");
  return out === "" ? passed("\"\"", out) : failed("\"\"", out, undefined, false, false, "medium");
});

test("N-22", "Emojis are preserved through normalization", () => {
  const out = normalizeCaption("Proud of our volunteers 🌿🌱!");
  const exp = "proud of our volunteers 🌿🌱!";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-23", "Hindi Devanagari text preserved correctly", () => {
  const inp = "हमारे स्वयंसेवक पर्यावरण की रक्षा करते हैं";
  const out = normalizeCaption(inp);
  const exp = inp.toLowerCase(); // Hindi has no case, should stay identical
  return out === exp ? passed(exp, out) : failed(exp, out, "NFKC + case fold must preserve Devanagari", false, false, "medium");
});

test("N-24", "Mixed hashtags remain intact", () => {
  const out = normalizeCaption("Great event! #CleanIndia #GreenEarth");
  const exp = "great event! #cleanindia #greenearth";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "low");
});

test("N-25", "Normalization is idempotent: normalize(normalize(x)) === normalize(x)", () => {
  const raw = "   Join us THIS Sunday! 🌱  https://example.com   ";
  const once = normalizeCaption(raw);
  const twice = normalizeCaption(once);
  return once === twice
    ? passed(once, twice)
    : failed(once, twice, "Normalization must be idempotent", false, false, "critical");
});

test("N-26", "Non-breaking space (U+00A0) collapsed to regular space", () => {
  const out = normalizeCaption("hello\u00A0world");
  const exp = "hello world";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

test("N-27", "Tab character collapsed to single space", () => {
  const out = normalizeCaption("hello\tworld");
  const exp = "hello world";
  return out === exp ? passed(exp, out) : failed(exp, out, undefined, false, false, "medium");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Hash Determinism
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Hash Determinism");

test("H-01", "Same text always produces same hash", () => {
  const { hash: h1 } = processCaption("plant trees today.");
  const { hash: h2 } = processCaption("plant trees today.");
  return h1 === h2
    ? passed(h1, h2)
    : failed(h1, h2, "Hash must be deterministic", false, false, "critical");
});

test("H-02", "Different text produces different hash", () => {
  const { hash: h1 } = processCaption("plant trees today.");
  const { hash: h2 } = processCaption("plant trees tomorrow.");
  return h1 !== h2
    ? passed("different hashes", `h1=${h1.slice(0,8)}…, h2=${h2.slice(0,8)}…`)
    : failed("different hashes", "SAME HASH — collision!", "Hash collision between different captions", false, false, "critical");
});

test("H-03", "Case difference yields same hash (because normalizer folds)", () => {
  const { hash: h1 } = processCaption("Join Us Today!");
  const { hash: h2 } = processCaption("join us today!");
  return h1 === h2
    ? passed(h1.slice(0,16) + "…", h2.slice(0,16) + "…")
    : failed(h1.slice(0,16) + "…", h2.slice(0,16) + "…", "Case must be folded before hashing", false, false, "critical");
});

test("H-04", "Leading/trailing whitespace difference yields same hash", () => {
  const { hash: h1 } = processCaption("  plant trees.  ");
  const { hash: h2 } = processCaption("plant trees.");
  return h1 === h2
    ? passed(h1.slice(0,16) + "…", h2.slice(0,16) + "…")
    : failed(h1.slice(0,16) + "…", h2.slice(0,16) + "…", "Whitespace must be trimmed before hashing", false, false, "critical");
});

test("H-05", "Multiple spaces yields same hash as single space", () => {
  const { hash: h1 } = processCaption("plant   trees   today.");
  const { hash: h2 } = processCaption("plant trees today.");
  return h1 === h2
    ? passed(h1.slice(0,16) + "…", h2.slice(0,16) + "…")
    : failed(h1.slice(0,16) + "…", h2.slice(0,16) + "…", "Internal spaces must be collapsed before hashing", false, false, "critical");
});

test("H-06", "CRLF vs LF yields same hash", () => {
  const { hash: h1 } = processCaption("line1\r\nline2");
  const { hash: h2 } = processCaption("line1\nline2");
  return h1 === h2
    ? passed(h1.slice(0,16) + "…", h2.slice(0,16) + "…")
    : failed(h1.slice(0,16) + "…", h2.slice(0,16) + "…", "CRLF must normalize before hashing", false, false, "critical");
});

test("H-07", "Hash is 64-character lowercase hex string", () => {
  const { hash } = processCaption("plant trees today.");
  const valid = /^[a-f0-9]{64}$/.test(hash);
  return valid
    ? passed("64-char lowercase hex", hash)
    : failed("64-char lowercase hex", hash, undefined, false, false, "critical");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Tier 1A: Exact Caption Matching (Hash-Based)
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Tier1A Exact Match");

test("T1-01", "Identical text matches Tier 1 (exact)", () => {
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact" && r.confidence === 1.0 && !r.needsReview
    ? passed(exp, actual)
    : failed(exp, actual, undefined, false, true, "critical");
});

test("T1-02", "Uppercase input matches Tier 1 (case-insensitive)", () => {
  const r = matchCaption(CANONICAL_MEDIUM.toUpperCase(), ACTIVE_MEDIUM);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, "Case difference alone must not prevent Tier 1 match", false, true, "critical");
});

test("T1-03", "Leading/trailing whitespace stripped before matching", () => {
  const r = matchCaption("   " + CANONICAL_MEDIUM + "   ", ACTIVE_MEDIUM);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, undefined, false, true, "critical");
});

test("T1-04", "Multiple internal spaces normalized before matching", () => {
  const withExtraSpaces = CANONICAL_MEDIUM.replace(/ /g, "   ");
  const r = matchCaption(withExtraSpaces, ACTIVE_MEDIUM);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, undefined, false, true, "critical");
});

test("T1-05", "CRLF line endings normalized to LF before matching", () => {
  const withCRLF = CANONICAL_LONG.replace(/\n/g, "\r\n");
  const r = matchCaption(withCRLF, ACTIVE_LONG);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, undefined, false, true, "critical");
});

test("T1-06", "Smart quotes normalized before matching", () => {
  const withSmartQuotes = "\u201C" + CANONICAL_MEDIUM.replace(/"/g, "\u201D") + "\u201D";
  // Create a canonical with ASCII quotes, volunteer uses smart quotes
  const canonWithQuotes = `"Join us this Sunday" for our Annual Tree Planting Drive!`;
  const activeCap = makeCaptions([{ id: "cap-quotes", raw: canonWithQuotes }]);
  const r = matchCaption(`\u201CJoin us this Sunday\u201D for our Annual Tree Planting Drive!`, activeCap);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, "Smart quotes must normalize to ASCII before hash comparison", false, true, "high");
});

test("T1-07", "Em-dash normalized to hyphen before matching", () => {
  const activeCap = makeCaptions([{ id: "cap-dash", raw: "Act now - not tomorrow" }]);
  const r = matchCaption("Act now \u2014 not tomorrow", activeCap);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, "Em-dash must normalize to hyphen", false, true, "high");
});

test("T1-08", "Trailing '... more' stripped before matching", () => {
  const r = matchCaption(CANONICAL_MEDIUM + "... more", ACTIVE_MEDIUM);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, "Instagram '... more' truncation marker must be stripped", false, true, "high");
});

test("T1-09", "Zero-width spaces stripped before matching", () => {
  const withZWS = CANONICAL_MEDIUM.replace(/ /g, " \u200B");
  const r = matchCaption(withZWS, ACTIVE_MEDIUM);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, "Zero-width spaces must be stripped before hash comparison", false, true, "high");
});

test("T1-10", "Emoji preserved: same emoji text matches Tier 1", () => {
  const captionWithEmoji = "Great work by our team! 🌿🌱 #CleanIndia";
  const activeCap = makeCaptions([{ id: "cap-emoji", raw: captionWithEmoji }]);
  const r = matchCaption(captionWithEmoji, activeCap);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, "Emoji-containing captions must still Tier 1 match when identical", false, true, "high");
});

test("T1-11", "URL in canonical replaced with {{url}} — volunteer uses same URL and matches", () => {
  const canonRaw = "Register at https://example.com/signup today";
  const activeCap = makeCaptions([{ id: "cap-url", raw: canonRaw }]);
  const r = matchCaption("Register at https://example.com/signup today", activeCap);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, undefined, false, true, "medium");
});

test("T1-12", "Tier 1 returns captionId correctly", () => {
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const exp = "cap-medium";
  const actual = r.matched ? r.captionId : "NOT_MATCHED";
  return r.matched && r.captionId === "cap-medium"
    ? passed(exp, actual)
    : failed(exp, actual, "captionId must match the active caption record", false, true, "critical");
});

test("T1-13", "Tier 1 confidence is exactly 1.0", () => {
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const actual = r.matched ? String(r.confidence) : "N/A";
  return r.matched && r.confidence === 1.0
    ? passed("1.0", actual)
    : failed("1.0", actual, undefined, false, true, "critical");
});

test("T1-14", "Tier 1 needsReview is false", () => {
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const actual = r.matched ? String(r.needsReview) : "N/A";
  return r.matched && r.needsReview === false
    ? passed("false", actual)
    : failed("false", actual, "Tier 1 matches must NEVER be routed to review", false, false, "critical");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Tier 1B: Approved Variant Matching
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Tier1B Approved Variant");

test("V-01", "Known approved variant matches via Tier 1B", () => {
  const variantRaw = CANONICAL_MEDIUM + " 🌱";
  const { hash: variantHash } = processCaption(variantRaw);
  const variants: MatchableVariant[] = [{ caption_id: "cap-medium", variant_hash: variantHash }];
  const r = matchCaption(variantRaw, ACTIVE_MEDIUM, variants);
  const exp = "APPROVED_VARIANT";
  const actual = describeResult(r);
  return r.matched && r.tier === "manual_approved"
    ? passed(exp, actual)
    : failed(exp, actual, undefined, false, true, "critical");
});

test("V-02", "Approved variant has confidence 1.0 and no review", () => {
  const variantRaw = CANONICAL_MEDIUM + " — with love!";
  const { hash: variantHash } = processCaption(variantRaw);
  const variants: MatchableVariant[] = [{ caption_id: "cap-medium", variant_hash: variantHash }];
  const r = matchCaption(variantRaw, ACTIVE_MEDIUM, variants);
  const actual = r.matched ? `conf=${r.confidence},review=${r.needsReview}` : "NO_MATCH";
  return r.matched && r.confidence === 1.0 && r.needsReview === false
    ? passed("conf=1,review=false", actual)
    : failed("conf=1,review=false", actual, undefined, false, false, "critical");
});

test("V-03", "Unknown variant (not approved) does not match via Tier 1B", () => {
  const { hash: randomHash } = processCaption("some other caption entirely");
  const variants: MatchableVariant[] = [{ caption_id: "cap-medium", variant_hash: randomHash }];
  // Volunteer posts canonical exactly — should still be Tier1A
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM, variants);
  const exp = "TIER1_EXACT";
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed(exp, actual)
    : failed(exp, actual, undefined, false, false, "medium");
});

test("V-04", "Variant from ineligible caption (embargo) is not matched", () => {
  const futureCaptions = makeCaptions([{
    id: "cap-future",
    raw: "Campaign starts next month! Join us.",
    released_at: "2027-01-01T00:00:00Z",
  }]);
  const variantRaw = "Campaign starts next month! Join us. 🌱";
  const { hash: variantHash } = processCaption(variantRaw);
  const variants: MatchableVariant[] = [{ caption_id: "cap-future", variant_hash: variantHash }];
  const r = matchCaption(variantRaw, futureCaptions, variants, {
    postedAt: "2026-01-01T00:00:00Z",
  });
  const exp = "NO_MATCH(outside_embargo_window)";
  const actual = describeResult(r);
  return !r.matched && r.reason === "outside_embargo_window"
    ? passed(exp, actual)
    : failed(exp, actual, "Variant from embargoed caption must not bypass temporal filter", true, false, "critical");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Tier 2: Fuzzy Matching
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Tier2 Fuzzy Match");

test("F-01", "Single character typo routes to Tier 2 review", () => {
  // "gloves" → "glove" (drop 's')
  const typoCaption = CANONICAL_MEDIUM.replace("gloves", "glove");
  const r = matchCaption(typoCaption, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier2_fuzzy" && r.needsReview === true
    ? passed("TIER2_FUZZY(review=true)", actual)
    : failed("TIER2_FUZZY(review=true)", actual, undefined, false, true, "high");
});

test("F-02", "Single word swapped routes to Tier 2 review", () => {
  const swapCaption = CANONICAL_MEDIUM.replace("Annual", "Yearly");
  const r = matchCaption(swapCaption, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier2_fuzzy" && r.needsReview === true
    ? passed("TIER2_FUZZY(review=true)", actual)
    : failed("TIER2_FUZZY(review=true)", actual, "Synonym swap should land in Tier 2", false, true, "medium");
});

test("F-03", "Prepended greeting routes to Tier 2 (not Tier 1)", () => {
  const withGreeting = "Namaste volunteers! " + CANONICAL_MEDIUM;
  const r = matchCaption(withGreeting, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  // Must NOT be Tier1_exact (hash is different), must be Tier2 or matched
  if (r.matched && r.tier === "tier1_exact") {
    return failed("TIER2_FUZZY or unmatched", actual, "Prepended greeting changes hash — must NOT be Tier1_exact (would skip review)", true, false, "critical");
  }
  return r.matched && r.tier === "tier2_fuzzy"
    ? passed("TIER2_FUZZY", actual)
    : failed("TIER2_FUZZY", actual, undefined, false, true, "high");
});

test("F-04", "Appended hashtags route to Tier 2 (not Tier 1)", () => {
  const withHashtags = CANONICAL_MEDIUM + " #CleanIndia #YouthWing";
  const r = matchCaption(withHashtags, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  if (r.matched && r.tier === "tier1_exact") {
    return failed("TIER2_FUZZY", actual, "Appended hashtags change hash — must NOT be Tier1_exact", true, false, "critical");
  }
  return r.matched && r.tier === "tier2_fuzzy"
    ? passed("TIER2_FUZZY", actual)
    : failed("TIER2_FUZZY", actual, "Appended hashtags should still yield fuzzy match", false, true, "high");
});

test("F-05", "Greeting + caption body + hashtags — high confidence fuzzy match", () => {
  const realWorld = "Namaste friends! " + CANONICAL_MEDIUM + " #GreenEarth #CleanIndia";
  const r = matchCaption(realWorld, ACTIVE_MEDIUM);
  const conf = r.matched ? r.confidence : 0;
  const actual = describeResult(r);
  return r.matched && r.tier === "tier2_fuzzy" && conf >= 0.93
    ? passed("TIER2_FUZZY(conf>=0.93)", actual)
    : failed("TIER2_FUZZY(conf>=0.93)", actual, `Got confidence ${conf}`, false, true, "high");
});

test("F-06", "Partial quote of long canonical (second paragraph) matched as Tier 2", () => {
  const partialQuote =
    "Namaste! Join our volunteer chapter this Saturday at 8:00 AM at the city central grounds. Bring reusable water bottles, comfortable walking shoes, and gloves. Refreshments and saplings will be provided on-site. #GreenerTomorrow";
  const r = matchCaption(partialQuote, ACTIVE_LONG);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier2_fuzzy" && r.confidence >= 0.90
    ? passed("TIER2_FUZZY(conf>=0.90)", actual)
    : failed("TIER2_FUZZY(conf>=0.90)", actual, "Partial paragraph quote from long caption must be captured", false, true, "high");
});

test("F-07", "Fuzzy match confidence is within [0, 1]", () => {
  const typoCaption = CANONICAL_MEDIUM.replace("gloves", "glove");
  const r = matchCaption(typoCaption, ACTIVE_MEDIUM);
  if (!r.matched) return failed("[0,1]", "NOT_MATCHED", undefined, false, true, "critical");
  const conf = r.confidence;
  return conf >= 0 && conf <= 1
    ? passed("[0,1]", String(conf))
    : failed("[0,1]", String(conf), "Confidence must be in [0,1]", false, false, "critical");
});

test("F-08", "Fuzzy match always returns captionId", () => {
  const typoCaption = CANONICAL_MEDIUM.replace("gloves", "glove");
  const r = matchCaption(typoCaption, ACTIVE_MEDIUM);
  const actual = r.matched ? r.captionId : "NONE";
  return r.matched && r.captionId === "cap-medium"
    ? passed("cap-medium", actual)
    : failed("cap-medium", actual, undefined, false, true, "critical");
});

test("F-09", "Fuzzy match always sets needsReview = true", () => {
  const typoCaption = CANONICAL_MEDIUM.replace("gloves", "glove");
  const r = matchCaption(typoCaption, ACTIVE_MEDIUM);
  const actual = r.matched ? String(r.needsReview) : "NOT_MATCHED";
  return r.matched && r.needsReview === true
    ? passed("true", actual)
    : failed("true", actual, "Tier 2 fuzzy match MUST require human review", false, false, "critical");
});

test("F-10", "Fuzzy match provides matchedSegment field", () => {
  const withGreeting = "Namaste! " + CANONICAL_MEDIUM;
  const r = matchCaption(withGreeting, ACTIVE_MEDIUM);
  if (!r.matched || r.tier !== "tier2_fuzzy") return failed("segment present", "NOT_TIER2", undefined, false, true, "medium");
  const actual = r.matchedSegment ?? "MISSING";
  return ["full", "core_body", "paragraph"].includes(actual)
    ? passed("full|core_body|paragraph", actual)
    : failed("full|core_body|paragraph", actual, undefined, false, false, "medium");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Discard Cases (False Positive Prevention)
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Discard / False Positive Prevention");

test("D-01", "Completely unrelated post is discarded", () => {
  const r = matchCaption("Having great pizza with family! #weekend #foodie", ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched && r.reason === "below_similarity_threshold"
    ? passed("NO_MATCH", actual)
    : failed("NO_MATCH", actual, "Unrelated personal post must be discarded", true, false, "critical");
});

test("D-02", "Empty string caption is discarded", () => {
  const r = matchCaption("", ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched && r.reason === "empty_caption"
    ? passed("NO_MATCH(empty_caption)", actual)
    : failed("NO_MATCH(empty_caption)", actual, undefined, true, false, "critical");
});

test("D-03", "Null caption is discarded", () => {
  const r = matchCaption(null, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched && r.reason === "empty_caption"
    ? passed("NO_MATCH(empty_caption)", actual)
    : failed("NO_MATCH(empty_caption)", actual, undefined, true, false, "critical");
});

test("D-04", "Undefined caption is discarded", () => {
  const r = matchCaption(undefined, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched && r.reason === "empty_caption"
    ? passed("NO_MATCH(empty_caption)", actual)
    : failed("NO_MATCH(empty_caption)", actual, undefined, true, false, "critical");
});

test("D-05", "Whitespace-only caption is discarded", () => {
  const r = matchCaption("   \t  ", ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched && r.reason === "empty_caption"
    ? passed("NO_MATCH(empty_caption)", actual)
    : failed("NO_MATCH(empty_caption)", actual, undefined, true, false, "critical");
});

test("D-06", "No active captions returns no_active_captions", () => {
  const r = matchCaption(CANONICAL_MEDIUM, []);
  const actual = describeResult(r);
  return !r.matched && r.reason === "no_active_captions"
    ? passed("NO_MATCH(no_active_captions)", actual)
    : failed("NO_MATCH(no_active_captions)", actual, undefined, false, false, "critical");
});

test("D-07", "Partial caption (< 75% of canonical length) is discarded", () => {
  // Post only the first 10 words of the medium canonical (much less than 75%)
  const partialShort = "Join us this Sunday for our Annual";
  const r = matchCaption(partialShort, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched
    ? passed("NO_MATCH", actual)
    : failed("NO_MATCH", actual, "Very short partial quote (< 75% length) must not match", true, false, "high");
});

test("D-08", "Short canonical — strict threshold prevents generic greeting match", () => {
  const shortCaptions = makeCaptions([{ id: "cap-republic", raw: "Happy Republic Day! #ProudIndian" }]);
  const r = matchCaption("Happy Independence Day! #ProudIndian with family", shortCaptions);
  const actual = describeResult(r);
  return !r.matched
    ? passed("NO_MATCH", actual)
    : failed("NO_MATCH", actual, "Different short holiday posts must not cross-match (false positive)", true, false, "critical");
});

test("D-09", "Hashtag-only post is discarded", () => {
  const r = matchCaption("#CleanIndia #GreenEarth #TreePlanting", ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched
    ? passed("NO_MATCH", actual)
    : failed("NO_MATCH", actual, "Hashtag-only caption must not match campaign", true, false, "high");
});

test("D-10", "Similar topic but different campaign is discarded", () => {
  // Different event, same general theme
  const similar = "Join us this Saturday for our Beach Cleanup Drive! Bring gloves and masks.";
  const r = matchCaption(similar, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  // This may legitimately be a close fuzzy match — the key check is it doesn't become Tier1_exact
  if (r.matched && r.tier === "tier1_exact") {
    return failed("NOT TIER1_EXACT", actual, "Different event must not get Tier 1 exact match", true, false, "critical");
  }
  return passed("Not Tier1_exact", actual, r.matched ? "Landed in Tier2 (review) which is acceptable" : "Correctly discarded");
});

test("D-11", "Completely different language post is discarded", () => {
  const r = matchCaption("आज हमने बहुत मज़ेदार कार्यक्रम किया! #YouthWing", ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched
    ? passed("NO_MATCH", actual)
    : failed("NO_MATCH", actual, "Unrelated post in different language must be discarded", true, false, "high");
});

test("D-12", "Single common word caption is discarded", () => {
  const r = matchCaption("join", ACTIVE_MEDIUM);
  const actual = describeResult(r);
  return !r.matched
    ? passed("NO_MATCH", actual)
    : failed("NO_MATCH", actual, "Single word must not match a medium-length caption", true, false, "high");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Temporal Embargo Filtering
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Temporal Embargo");

test("E-01", "Post published far before campaign release is filtered", () => {
  const datedCaptions = makeCaptions([{
    id: "cap-dated",
    raw: CANONICAL_MEDIUM,
    released_at: "2026-06-01T00:00:00Z",
  }]);
  const r = matchCaption(CANONICAL_MEDIUM, datedCaptions, [], {
    postedAt: "2026-01-01T00:00:00Z",
  });
  const actual = describeResult(r);
  return !r.matched && r.reason === "outside_embargo_window"
    ? passed("NO_MATCH(outside_embargo_window)", actual)
    : failed("NO_MATCH(outside_embargo_window)", actual, "Pre-campaign post must be filtered", true, false, "critical");
});

test("E-02", "Post published after release date matches normally", () => {
  const datedCaptions = makeCaptions([{
    id: "cap-dated",
    raw: CANONICAL_MEDIUM,
    released_at: "2026-06-01T00:00:00Z",
  }]);
  const r = matchCaption(CANONICAL_MEDIUM, datedCaptions, [], {
    postedAt: "2026-06-15T00:00:00Z",
  });
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT", actual)
    : failed("TIER1_EXACT", actual, "Post after release must match", false, true, "critical");
});

test("E-03", "Post within embargo tolerance window (< 48h before release) is allowed", () => {
  const datedCaptions = makeCaptions([{
    id: "cap-dated",
    raw: CANONICAL_MEDIUM,
    released_at: "2026-06-01T00:00:00Z",
  }]);
  // Post 24 hours before release (within 48h tolerance)
  const r = matchCaption(CANONICAL_MEDIUM, datedCaptions, [], {
    postedAt: "2026-05-31T00:00:00Z",
    embargoToleranceHours: 48,
  });
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT (within tolerance)", actual)
    : failed("TIER1_EXACT (within tolerance)", actual, "Post within tolerance window must match", false, true, "high");
});

test("E-04", "Post exactly at embargo boundary (tolerance - 1ms) is filtered", () => {
  const datedCaptions = makeCaptions([{
    id: "cap-dated",
    raw: CANONICAL_MEDIUM,
    released_at: "2026-06-01T00:00:00Z",
  }]);
  // 72h before release — outside 48h tolerance
  const r = matchCaption(CANONICAL_MEDIUM, datedCaptions, [], {
    postedAt: "2026-05-29T00:00:00Z",
    embargoToleranceHours: 48,
  });
  const actual = describeResult(r);
  return !r.matched && r.reason === "outside_embargo_window"
    ? passed("NO_MATCH(outside_embargo_window)", actual)
    : failed("NO_MATCH(outside_embargo_window)", actual, "Post outside tolerance must be filtered", true, false, "high");
});

test("E-05", "Caption without released_at always eligible", () => {
  // No released_at means no embargo filtering applied
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM, [], {
    postedAt: "2020-01-01T00:00:00Z",
  });
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT (no embargo)", actual)
    : failed("TIER1_EXACT (no embargo)", actual, "Caption with no released_at must always be eligible", false, true, "high");
});

test("E-06", "No postedAt option — no embargo filtering applied", () => {
  const datedCaptions = makeCaptions([{
    id: "cap-dated",
    raw: CANONICAL_MEDIUM,
    released_at: "2027-01-01T00:00:00Z",
  }]);
  // No postedAt provided — cannot filter
  const r = matchCaption(CANONICAL_MEDIUM, datedCaptions);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT (no timestamp provided)", actual)
    : failed("TIER1_EXACT (no timestamp provided)", actual, "Without postedAt, embargo must not apply", false, true, "high");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Multi-Caption Matching (Multiple Active Campaigns)
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Multi-Caption / Multi-Volunteer");

test("M-01", "Correct caption matched when multiple active campaigns exist", () => {
  const multiCaptions = makeCaptions([
    { id: "cap-A", raw: "Plant trees for a greener tomorrow. #CleanIndia" },
    { id: "cap-B", raw: "Beach cleanup this Saturday! Bring bags and energy." },
    { id: "cap-C", raw: CANONICAL_MEDIUM },
  ]);
  const r = matchCaption(CANONICAL_MEDIUM, multiCaptions);
  const actual = r.matched ? r.captionId : "NONE";
  return r.matched && r.captionId === "cap-C" && r.tier === "tier1_exact"
    ? passed("cap-C (TIER1_EXACT)", actual)
    : failed("cap-C (TIER1_EXACT)", actual, "Must match the correct caption among multiple active campaigns", false, true, "critical");
});

test("M-02", "Same post caption matches same campaign regardless of volunteer", () => {
  // Two different volunteers post the same caption
  const r1 = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const r2 = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const same = r1.matched && r2.matched && r1.tier === r2.tier;
  return same
    ? passed("both matched with same tier", "matched")
    : failed("both matched with same tier", `r1=${describeResult(r1)}, r2=${describeResult(r2)}`, "Same caption must yield same result for all volunteers", false, true, "critical");
});

test("M-03", "Ambiguous post (matches two similar campaigns) is flagged", () => {
  const similarCaptions = makeCaptions([
    { id: "cap-bandra", raw: "Join us this Sunday at Bandra for Beach Cleanup! Bring bags." },
    { id: "cap-juhu", raw: "Join us this Sunday at Juhu for Beach Cleanup! Bring bags." },
  ]);
  const ambiguousPost = "Join us this Sunday at Beach Cleanup! Bring bags.";
  const r = matchCaption(ambiguousPost, similarCaptions);
  const actual = describeResult(r);
  return r.matched && r.isAmbiguous === true && !!r.alternativeCaptionId
    ? passed("MATCHED(isAmbiguous=true)", actual)
    : failed("MATCHED(isAmbiguous=true)", actual, "Ambiguous matches must be flagged for reviewer", false, false, "high");
});

test("M-04", "Non-ambiguous post (clear winner) is NOT flagged as ambiguous", () => {
  const clearCaption = CANONICAL_MEDIUM; // exact match — unambiguous
  const r = matchCaption(clearCaption, ACTIVE_MEDIUM);
  const actual = r.matched ? `isAmbiguous=${r.isAmbiguous}` : "NOT_MATCHED";
  return r.matched && !r.isAmbiguous
    ? passed("isAmbiguous=false", actual)
    : failed("isAmbiguous=false", actual, "Clear exact match must not be flagged ambiguous", false, false, "medium");
});

test("M-05", "Duplicate post caption (sent twice) produces same result both times", () => {
  const r1 = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const r2 = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  const same = r1.matched === r2.matched &&
    (r1.matched && r2.matched ? r1.tier === r2.tier && r1.captionId === r2.captionId : true);
  return same
    ? passed("idempotent result", "both identical")
    : failed("idempotent result", `r1=${describeResult(r1)}, r2=${describeResult(r2)}`, "matchCaption must be deterministic/idempotent", false, false, "critical");
});

test("M-06", "Post matching Caption A does NOT match Caption B", () => {
  const captionA_raw = "Plant trees for a greener tomorrow. #GreenIndia";
  const captionB_raw = "Beach cleanup this Saturday! Bring bags and energy.";
  const multiCaptions = makeCaptions([
    { id: "cap-A", raw: captionA_raw },
    { id: "cap-B", raw: captionB_raw },
  ]);
  // Post exactly Caption A
  const r = matchCaption(captionA_raw, multiCaptions);
  const actual = r.matched ? r.captionId : "NONE";
  return r.matched && r.captionId === "cap-A"
    ? passed("cap-A", actual)
    : failed("cap-A", actual, "Must match Caption A, not B", false, true, "critical");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — Special Characters, Unicode, Emojis
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Special Characters & Unicode");

test("U-01", "Arabic text caption: exact match", () => {
  const arabic = "انضم إلينا اليوم لزراعة الأشجار! #بيئتنا";
  const activeCap = makeCaptions([{ id: "cap-ar", raw: arabic }]);
  const r = matchCaption(arabic, activeCap);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT", actual)
    : failed("TIER1_EXACT", actual, "Arabic text caption must exact-match", false, true, "medium");
});

test("U-02", "Mixed emoji + text: exact match preserved", () => {
  const captionWithEmoji = "🌳 Plant. Grow. Thrive. 🌱 Join #YouthDrive today!";
  const activeCap = makeCaptions([{ id: "cap-emoji2", raw: captionWithEmoji }]);
  const r = matchCaption(captionWithEmoji, activeCap);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT", actual)
    : failed("TIER1_EXACT", actual, "Emoji+text must exact-match", false, true, "medium");
});

test("U-03", "Different emoji in volunteer post routes to Tier 2", () => {
  const canonRaw = "Great work volunteers! 🌱 Keep it up!";
  const activeCap = makeCaptions([{ id: "cap-em3", raw: canonRaw }]);
  const r = matchCaption("Great work volunteers! 🌿 Keep it up!", activeCap);
  const actual = describeResult(r);
  // Different emoji ≠ exact match; should land in Tier2 or be discarded (not Tier1)
  if (r.matched && r.tier === "tier1_exact") {
    return failed("NOT TIER1_EXACT", actual, "Different emoji must NOT produce Tier 1 hash match", true, false, "critical");
  }
  return passed("Not Tier1_exact (Tier2 or discarded)", actual);
});

test("U-04", "NFKC normalization: fullwidth characters match ASCII equivalents", () => {
  // Fullwidth 'A' (U+FF21) should NFKC-normalize to 'A' (U+0041)
  const activeCap = makeCaptions([{ id: "cap-fw", raw: "join us today!" }]);
  const r = matchCaption("\uFF2A\uFF4F\uFF49\uFF4E \uFF55\uFF53 \uFF54\uFF4F\uFF44\uFF41\uFF59!", activeCap); // ｊｏｉｎ ｕｓ ｔｏｄａｙ！
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT (NFKC normalized)", actual)
    : failed("TIER1_EXACT (NFKC normalized)", actual, "Fullwidth chars must NFKC-normalize to ASCII before matching", false, true, "medium");
});

test("U-05", "Devanagari caption exact match preserved through normalization", () => {
  const hindi = "आज हम पर्यावरण की रक्षा करेंगे। #हरितभारत";
  const activeCap = makeCaptions([{ id: "cap-hi", raw: hindi }]);
  const r = matchCaption(hindi, activeCap);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT", actual)
    : failed("TIER1_EXACT", actual, "Devanagari caption must exact-match", false, true, "medium");
});

test("U-06", "Combining diacritics (NFC vs NFD) are both recognized as same", () => {
  // 'é' as precomposed (U+00E9) vs 'é' as combining (U+0065 + U+0301)
  const precomposed = "caf\u00E9 event today";
  const combining = "cafe\u0301 event today";
  const activeCap = makeCaptions([{ id: "cap-diac", raw: precomposed }]);
  const r = matchCaption(combining, activeCap);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT (NFC normalization)", actual)
    : failed("TIER1_EXACT (NFC normalization)", actual, "NFKC must unify NFC and NFD representations", false, true, "medium");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — Adaptive Threshold
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Adaptive Threshold");

test("AT-01", "Short caption (≤ 10 words) uses strict threshold 0.94", () => {
  const t = getAdaptiveThreshold(5);
  return t === 0.94
    ? passed("0.94", String(t))
    : failed("0.94", String(t), undefined, false, false, "critical");
});

test("AT-02", "Medium caption (11-45 words) uses standard threshold 0.89", () => {
  const t = getAdaptiveThreshold(25);
  return t === 0.89
    ? passed("0.89", String(t))
    : failed("0.89", String(t), undefined, false, false, "critical");
});

test("AT-03", "Long caption (> 45 words) uses forgiving threshold 0.84", () => {
  const t = getAdaptiveThreshold(60);
  return t === 0.84
    ? passed("0.84", String(t))
    : failed("0.84", String(t), undefined, false, false, "critical");
});

test("AT-04", "Boundary: exactly 10 words uses short threshold 0.94", () => {
  const t = getAdaptiveThreshold(10);
  return t === 0.94
    ? passed("0.94", String(t))
    : failed("0.94", String(t), undefined, false, false, "medium");
});

test("AT-05", "Boundary: exactly 11 words uses medium threshold 0.89", () => {
  const t = getAdaptiveThreshold(11);
  return t === 0.89
    ? passed("0.89", String(t))
    : failed("0.89", String(t), undefined, false, false, "medium");
});

test("AT-06", "Boundary: exactly 45 words uses medium threshold 0.89", () => {
  const t = getAdaptiveThreshold(45);
  return t === 0.89
    ? passed("0.89", String(t))
    : failed("0.89", String(t), undefined, false, false, "medium");
});

test("AT-07", "Boundary: exactly 46 words uses long threshold 0.84", () => {
  const t = getAdaptiveThreshold(46);
  return t === 0.84
    ? passed("0.84", String(t))
    : failed("0.84", String(t), undefined, false, false, "medium");
});

test("AT-08", "Custom short threshold override is applied", () => {
  const t = getAdaptiveThreshold(5, { shortThreshold: 0.97 });
  return t === 0.97
    ? passed("0.97", String(t))
    : failed("0.97", String(t), undefined, false, false, "medium");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — Jaro / Jaro-Winkler Similarity
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Jaro / Jaro-Winkler");

test("JW-01", "Identical strings: Jaro = 1.0", () => {
  const s = jaroSimilarity("hello world", "hello world");
  return s === 1.0 ? passed("1.0", String(s)) : failed("1.0", String(s), undefined, false, false, "critical");
});

test("JW-02", "Empty string vs non-empty: Jaro = 0.0", () => {
  const s = jaroSimilarity("", "hello");
  return s === 0.0 ? passed("0.0", String(s)) : failed("0.0", String(s), undefined, false, false, "critical");
});

test("JW-03", "Completely different strings: Jaro close to 0", () => {
  const s = jaroSimilarity("abc", "xyz");
  return s === 0.0 ? passed("0.0", String(s)) : failed("0.0", String(s), "Fully different should yield 0.0", false, false, "medium");
});

test("JW-04", "Jaro-Winkler identical: = 1.0", () => {
  const s = jaroWinklerSimilarity("hello", "hello");
  return s === 1.0 ? passed("1.0", String(s)) : failed("1.0", String(s), undefined, false, false, "critical");
});

test("JW-05", "Jaro-Winkler: single-letter suffix typo >= 0.95", () => {
  const s = jaroWinklerSimilarity(
    "join us this sunday for our tree planting drive! bring gloves.",
    "join us this sunday for our tree planting drive! bring glove."
  );
  return s >= 0.95
    ? passed(">= 0.95", String(s.toFixed(4)))
    : failed(">= 0.95", String(s.toFixed(4)), undefined, false, false, "high");
});

test("JW-06", "Jaro-Winkler: prefix advantage applied", () => {
  // "carp" vs "car" - share prefix "car" so JW > Jaro
  const jaro = jaroSimilarity("carp", "car");
  const jw = jaroWinklerSimilarity("carp", "car");
  return jw > jaro
    ? passed("JW > Jaro", `Jaro=${jaro.toFixed(4)}, JW=${jw.toFixed(4)}`)
    : failed("JW > Jaro", `Jaro=${jaro.toFixed(4)}, JW=${jw.toFixed(4)}`, "Jaro-Winkler must boost prefix matches", false, false, "medium");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — Token Similarity
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Token Containment Similarity");

test("TS-01", "Identical text: token similarity = 1.0", () => {
  const { score } = calculateTokenSimilarity("hello world today", "hello world today");
  return score === 1.0 ? passed("1.0", String(score)) : failed("1.0", String(score), undefined, false, false, "critical");
});

test("TS-02", "Canonical fully contained in longer candidate (>= 20 chars): score >= 0.93", () => {
  const canonical = "join us this sunday for tree planting";
  const candidate = "namaste! join us this sunday for tree planting! #green";
  const { score, isContained } = calculateTokenSimilarity(candidate, canonical);
  return score >= 0.93 && isContained
    ? passed("score>=0.93, isContained=true", `score=${score.toFixed(4)}, contained=${isContained}`)
    : failed("score>=0.93, isContained=true", `score=${score.toFixed(4)}, contained=${isContained}`, undefined, false, true, "high");
});

test("TS-03", "Empty candidate: token similarity = 0.0", () => {
  const { score } = calculateTokenSimilarity("", "hello world today");
  return score === 0.0 ? passed("0.0", String(score)) : failed("0.0", String(score), undefined, false, false, "medium");
});

test("TS-04", "85%+ canonical word coverage yields score >= 0.90", () => {
  // 7 of 8 canonical words present (88%)
  const canonical = "join us this sunday for tree planting";
  const candidate = "join us this sunday for tree planting drive"; // extra word
  const { score } = calculateTokenSimilarity(candidate, canonical);
  return score >= 0.90
    ? passed(">= 0.90", String(score.toFixed(4)))
    : failed(">= 0.90", String(score.toFixed(4)), undefined, false, true, "high");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — Segmentation Engine
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Caption Segmentation");

test("S-01", "Multi-line: greeting prefix extracted", () => {
  const cap = "Namaste volunteers!\n\nJoin us this Sunday for the drive.\n\n#GreenEarth";
  const seg = segmentCaption(cap);
  return seg.prefix === "namaste volunteers!"
    ? passed("namaste volunteers!", seg.prefix)
    : failed("namaste volunteers!", seg.prefix, undefined, false, false, "medium");
});

test("S-02", "Multi-line: core body isolated (no greeting/hashtags)", () => {
  const cap = "Namaste volunteers!\n\nJoin us this Sunday for the drive.\n\n#GreenEarth";
  const seg = segmentCaption(cap);
  return seg.cleanBody === "join us this sunday for the drive."
    ? passed("join us this sunday for the drive.", seg.cleanBody)
    : failed("join us this sunday for the drive.", seg.cleanBody, undefined, false, false, "medium");
});

test("S-03", "Hashtags extracted into array", () => {
  const cap = "Great work! #CleanIndia #YouthWing #GreenEarth";
  const seg = segmentCaption(cap);
  const hasAll = seg.hashtags.includes("#cleanindia") && seg.hashtags.includes("#youthwing") && seg.hashtags.includes("#greenearth");
  return hasAll
    ? passed("all hashtags extracted", seg.hashtags.join(", "))
    : failed("all hashtags extracted", seg.hashtags.join(", "), undefined, false, false, "medium");
});

test("S-04", "Single-line inline greeting extracted from body", () => {
  const cap = "Namaste all! Join us this Sunday for the tree drive. #Green";
  const seg = segmentCaption(cap);
  return seg.prefix === "namaste all!"
    ? passed("namaste all!", seg.prefix)
    : failed("namaste all!", seg.prefix, undefined, false, false, "medium");
});

test("S-05", "wordCount reflects cleanBody word count, not full caption", () => {
  const cap = "Namaste! Join us this Sunday for the drive. #GreenEarth #CleanIndia";
  const seg = segmentCaption(cap);
  const cleanBodyWords = countWords(seg.cleanBody);
  return seg.wordCount === cleanBodyWords
    ? passed(`${cleanBodyWords}`, String(seg.wordCount))
    : failed(String(cleanBodyWords), String(seg.wordCount), "wordCount must equal countWords(cleanBody)", false, false, "medium");
});

test("S-06", "null/undefined input returns empty segments", () => {
  const seg = segmentCaption(null);
  const allEmpty = seg.prefix === "" && seg.body === "" && seg.cleanBody === "" && seg.hashtags.length === 0;
  return allEmpty
    ? passed("all empty", JSON.stringify(seg))
    : failed("all empty sections", JSON.stringify(seg), undefined, false, false, "critical");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — Critical Logical Checks (Architecture Invariants)
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Architecture Invariants");

test("INV-01", "Tier 1 match NEVER has needsReview = true", () => {
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  if (!r.matched) return failed("matched=true,needsReview=false", "not matched", undefined, false, true, "critical");
  return r.tier === "tier1_exact" && r.needsReview === false
    ? passed("needsReview=false", `tier=${r.tier}, review=${r.needsReview}`)
    : failed("needsReview=false", `tier=${r.tier}, review=${r.needsReview}`, "Tier 1 must never go to review queue", false, false, "critical");
});

test("INV-02", "Approved variant NEVER has needsReview = true", () => {
  const { hash: variantHash } = processCaption(CANONICAL_MEDIUM + " — variant");
  const variants: MatchableVariant[] = [{ caption_id: "cap-medium", variant_hash: variantHash }];
  const r = matchCaption(CANONICAL_MEDIUM + " — variant", ACTIVE_MEDIUM, variants);
  if (!r.matched) return failed("matched=true,needsReview=false", "not matched", undefined, false, true, "critical");
  return r.tier === "manual_approved" && r.needsReview === false
    ? passed("needsReview=false", `tier=${r.tier}, review=${r.needsReview}`)
    : failed("needsReview=false", `tier=${r.tier}, review=${r.needsReview}`, "Approved variant must never go to review queue", false, false, "critical");
});

test("INV-03", "Tier 2 match ALWAYS has needsReview = true", () => {
  const typoCaption = CANONICAL_MEDIUM.replace("gloves", "glove");
  const r = matchCaption(typoCaption, ACTIVE_MEDIUM);
  if (!r.matched) return failed("matched=true,needsReview=true", "not matched", undefined, false, true, "critical");
  return r.tier === "tier2_fuzzy" && r.needsReview === true
    ? passed("needsReview=true", `tier=${r.tier}, review=${r.needsReview}`)
    : failed("needsReview=true", `tier=${r.tier}, review=${r.needsReview}`, "Fuzzy match MUST always go to review", false, false, "critical");
});

test("INV-04", "matchCaption never throws for any input combination", () => {
  const inputs = [null, undefined, "", "   ", "normal text", CANONICAL_LONG];
  const captionSets = [[], ACTIVE_MEDIUM, ACTIVE_LONG];
  let threw = false;
  let thrownInput = "";
  for (const inp of inputs) {
    for (const caps of captionSets) {
      try {
        matchCaption(inp as string, caps);
      } catch (e) {
        threw = true;
        thrownInput = `input=${JSON.stringify(inp)?.slice(0, 30)}, caps.length=${caps.length}`;
      }
    }
  }
  return !threw
    ? passed("no exceptions", "clean")
    : failed("no exceptions", `THREW on: ${thrownInput}`, undefined, false, false, "critical");
});

test("INV-05", "Match result always has normalizedCaption when matched", () => {
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  if (!r.matched) return failed("matched", "not matched", undefined, false, true, "critical");
  const hasNorm = typeof r.normalizedCaption === "string" && r.normalizedCaption.length > 0;
  return hasNorm
    ? passed("normalizedCaption present", r.normalizedCaption.slice(0, 40) + "…")
    : failed("normalizedCaption present", "MISSING OR EMPTY", undefined, false, false, "medium");
});

test("INV-06", "Match result always has captionHash when matched", () => {
  const r = matchCaption(CANONICAL_MEDIUM, ACTIVE_MEDIUM);
  if (!r.matched) return failed("matched", "not matched", undefined, false, true, "critical");
  const hasHash = typeof r.captionHash === "string" && /^[a-f0-9]{64}$/.test(r.captionHash);
  return hasHash
    ? passed("valid captionHash", r.captionHash.slice(0, 16) + "…")
    : failed("valid captionHash", r.captionHash ?? "MISSING", undefined, false, false, "medium");
});

test("INV-07", "highestScore is provided when no match found (below threshold)", () => {
  const r = matchCaption("completely unrelated text here today friends", ACTIVE_MEDIUM);
  if (r.matched) return failed("not matched", "matched", undefined, true, false, "critical");
  if (r.reason !== "below_similarity_threshold") {
    return passed("N/A (empty or no captions reason)", r.reason);
  }
  const hasScore = typeof r.highestScore === "number" && r.highestScore >= 0 && r.highestScore <= 1;
  return hasScore
    ? passed("highestScore in [0,1]", String(r.highestScore))
    : failed("highestScore in [0,1]", String(r.highestScore ?? "MISSING"), undefined, false, false, "medium");
});

test("INV-08", "computeCaptionSimilarity(x, x) === 1.0 for any non-empty string", () => {
  const texts = [CANONICAL_SHORT, CANONICAL_MEDIUM, "🌱 test", "hello"];
  let fail = "";
  for (const t of texts) {
    const norm = normalizeCaption(t);
    if (norm.length === 0) continue;
    const s = computeCaptionSimilarity(norm, norm);
    if (s !== 1.0) { fail = `"${t}" got ${s}`; break; }
  }
  return !fail
    ? passed("1.0 for all", "all 1.0")
    : failed("1.0 for all", fail, undefined, false, false, "critical");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — Known Tricky Edge Cases (Critical Business Scenarios)
// ─────────────────────────────────────────────────────────────────────────────

setCategory("Critical Edge Cases");

test("EC-01", "Post shorter than 20 chars does NOT trigger containment check", () => {
  // The containment logic requires canonical.length >= 20
  // A short canonical BELOW that threshold should NOT get a containment boost
  const shortCanon = "Plant trees!"; // 12 chars
  const activeCap = makeCaptions([{ id: "cap-s12", raw: shortCanon }]);
  const r = matchCaption("Namaste! Plant trees! #green #india #today #drive", activeCap);
  // Should not match via containment since canonical is < 20 chars
  // Could still match via token overlap if >= 4 tokens, but that's acceptable Tier2 behavior
  if (r.matched && r.tier === "tier1_exact") {
    return failed("NOT TIER1_EXACT", describeResult(r), "Short canonical contained in longer post should NOT yield Tier 1 hash match", true, false, "critical");
  }
  return passed("Not Tier1_exact", describeResult(r));
});

test("EC-02", "Very similar captions from different campaigns: each matches its own", () => {
  const capA = makeCaptions([{ id: "cap-sunday", raw: "Join us this Sunday for Beach Cleanup! Bring bags." }]);
  const capB = makeCaptions([{ id: "cap-saturday", raw: "Join us this Saturday for Beach Cleanup! Bring bags." }]);
  const rA = matchCaption("Join us this Sunday for Beach Cleanup! Bring bags.", capA);
  const rB = matchCaption("Join us this Saturday for Beach Cleanup! Bring bags.", capB);
  const aOk = rA.matched && rA.captionId === "cap-sunday";
  const bOk = rB.matched && rB.captionId === "cap-saturday";
  return aOk && bOk
    ? passed("each matches own", `A=${describeResult(rA)}, B=${describeResult(rB)}`)
    : failed("each matches own", `A=${describeResult(rA)}, B=${describeResult(rB)}`, "Sunday/Saturday campaigns must each match correctly", false, true, "high");
});

test("EC-03", "Punctuation-only difference matches Tier 1 exact (does not drop to review)", () => {
  // Canonical uses '!' — volunteer uses '.'
  const canonRaw = "Join us this Sunday for the drive!";
  const activeCap = makeCaptions([{ id: "cap-punct", raw: canonRaw }]);
  const r = matchCaption("Join us this Sunday for the drive.", activeCap);
  const actual = describeResult(r);
  // Now fixed via Tier 1C: identical words differing only by punctuation match Tier 1 directly
  return r.matched && r.tier === "tier1_exact" && r.confidence === 1.0 && !r.needsReview
    ? passed("TIER1_EXACT", actual, "Punctuation difference (! vs .) accurately matched as Tier 1 exact")
    : failed("TIER1_EXACT", actual, "Punctuation difference must match Tier 1 without human review", false, true, "high");
});

test("EC-04", "Reordered words are NOT exact match (different hash)", () => {
  const canonRaw = "Join us this Sunday for tree planting!";
  const activeCap = makeCaptions([{ id: "cap-reorder", raw: canonRaw }]);
  const r = matchCaption("For tree planting join us this Sunday!", activeCap);
  if (r.matched && r.tier === "tier1_exact") {
    return failed("NOT TIER1_EXACT", describeResult(r), "Reordered words change hash — must not be Tier 1 exact", true, false, "critical");
  }
  return passed("Not Tier1_exact", describeResult(r));
});

test("EC-05", "Internal newline variation matches Tier 1 exact (does not drop to review)", () => {
  // Caption with internal line-breaks where canonical had spaces
  const crazy = "\n\n\n   Join\t\tus   this\r\n\r\nSunday   for\n\nour Annual Tree Planting Drive! Bring gloves and water bottles.   \r\n";
  const r = matchCaption(crazy, ACTIVE_MEDIUM);
  const actual = describeResult(r);
  // Now fixed via Tier 1C: identical words differing only by line breaks match Tier 1 directly
  return r.matched && r.tier === "tier1_exact" && r.confidence === 1.0 && !r.needsReview
    ? passed("TIER1_EXACT", actual, "Internal line-break variations accurately matched as Tier 1 exact")
    : failed("TIER1_EXACT", actual, "Internal line-break variations must match Tier 1 without human review", false, true, "high");
});

test("EC-06", "Long caption: 3 consecutive newlines collapsed before hash", () => {
  const withExtraNL = CANONICAL_LONG.replace(/\n\n/g, "\n\n\n\n");
  const r = matchCaption(withExtraNL, ACTIVE_LONG);
  const actual = describeResult(r);
  return r.matched && r.tier === "tier1_exact"
    ? passed("TIER1_EXACT", actual)
    : failed("TIER1_EXACT", actual, "Extra newlines must be collapsed before hash comparison", false, true, "critical");
});

test("EC-07", "Security / Integrity: Different URL in candidate caption produces FALSE POSITIVE Tier 1 exact match", () => {
  // Canonical official URL: https://action.org/official-signup
  const officialCanon = "Register for our drive at https://action.org/official-signup today!";
  const activeCap = makeCaptions([{ id: "cap-url-sec", raw: officialCanon }]);

  // Phishing/attacker post: completely different malicious URL
  const maliciousPost = "Register for our drive at https://phishing-scam.com/steal-creds today!";
  const r = matchCaption(maliciousPost, activeCap);
  const actual = describeResult(r);

  // Because normalizer replaces ANY https?://... with {{url}}, both hashes match identically!
  // This yields a FALSE POSITIVE: malicious post gets Tier 1 Exact Match with 1.0 confidence!
  const hasVulnerability = r.matched && r.tier === "tier1_exact" && r.confidence === 1.0;
  return hasVulnerability
    ? failed("NO_MATCH or TIER2 (URL must match)", actual, "CRITICAL: URL tokenization treats any URL as identical, allowing phishing links or wrong URLs to match with 100% confidence", true, false, "critical")
    : passed("Differentiated URL", actual);
});

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS REPORTER
// ─────────────────────────────────────────────────────────────────────────────

function printReport(): void {
  const totalTests = results.length;
  const passedTests = results.filter((r) => r.passed);
  const failedTests = results.filter((r) => !r.passed);
  const falsePositives = results.filter((r) => !r.passed && r.isFalsePositive);
  const falseNegatives = results.filter((r) => !r.passed && r.isFalseNegative);

  const byCategory: Record<string, { pass: number; fail: number }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { pass: 0, fail: 0 };
    if (r.passed) byCategory[r.category].pass++;
    else byCategory[r.category].fail++;
  }

  console.log("\n" + "═".repeat(72));
  console.log("  QA MATCHING ENGINE — TEST REPORT");
  console.log("═".repeat(72));
  console.log(`  Total Tests  : ${totalTests}`);
  console.log(`  ✓ Passed     : ${passedTests.length}`);
  console.log(`  ✗ Failed     : ${failedTests.length}`);
  console.log(`  FP (False+)  : ${falsePositives.length}`);
  console.log(`  FN (False-)  : ${falseNegatives.length}`);
  console.log("─".repeat(72));

  console.log("\n  Results by Category:");
  for (const [cat, counts] of Object.entries(byCategory)) {
    const icon = counts.fail === 0 ? "✓" : "✗";
    console.log(`  ${icon}  ${cat.padEnd(32)} Pass: ${counts.pass}  Fail: ${counts.fail}`);
  }

  if (failedTests.length > 0) {
    console.log("\n" + "─".repeat(72));
    console.log("  FAILED TEST DETAILS:");
    console.log("─".repeat(72));
    for (const r of failedTests) {
      const severity = r.bugSeverity ? `[${r.bugSeverity.toUpperCase()}]` : "";
      const fp = r.isFalsePositive ? " [FALSE POSITIVE]" : "";
      const fn_ = r.isFalseNegative ? " [FALSE NEGATIVE]" : "";
      console.log(`\n  ${r.id}: ${r.name} ${severity}${fp}${fn_}`);
      console.log(`    Category : ${r.category}`);
      console.log(`    Expected : ${r.expected}`);
      console.log(`    Actual   : ${r.actual}`);
      if (r.note) console.log(`    Note     : ${r.note}`);
    }
  }

  console.log("\n" + "═".repeat(72));
  if (failedTests.length === 0) {
    console.log("  ALL TESTS PASSED — Matching engine fully validated.");
  } else {
    console.log(`  ${failedTests.length} TEST(S) FAILED — See details above.`);
    const critical = failedTests.filter((r) => r.bugSeverity === "critical");
    if (critical.length > 0) {
      console.log(`  ⚠️  ${critical.length} CRITICAL bug(s) detected.`);
    }
  }
  console.log("═".repeat(72) + "\n");

  if (failedTests.length > 0) {
    process.exit(1);
  }
}

printReport();

