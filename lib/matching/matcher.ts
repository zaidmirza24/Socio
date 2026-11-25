import {
  normalizeCaption,
  computeCaptionHash,
  segmentCaption,
  countWords,
  normalizeContentText,
  type CaptionSections,
} from "./normalizer.ts";

export interface MatchableCaption {
  id: string;
  caption_hash: string;
  canonical_caption: string;
  normalized_caption: string;
  released_at?: string | null;
}

export interface MatchableVariant {
  caption_id: string;
  variant_hash: string;
}

export interface AdaptiveThresholdOptions {
  shortThreshold?: number;  // Default: 0.94 for <= 10 words
  mediumThreshold?: number; // Default: 0.89 for 11-45 words
  longThreshold?: number;   // Default: 0.84 for > 45 words
}

export interface MatchCaptionOptions {
  postedAt?: string | Date | null;
  embargoToleranceHours?: number; // default 48 hours (ignored when sameDayOnly is true)
  adaptiveThresholds?: AdaptiveThresholdOptions;
  /**
   * Daily-caption rule: a post can only match a caption released on the SAME calendar day
   * (in `timeZone`). Each day has its own caption, so older / newer captions never match.
   */
  sameDayOnly?: boolean;
  /**
   * Soft day window (only with sameDayOnly). Captions released up to this many days before or
   * after the post's day are tried when no same-day caption matches. Such a match is NEVER
   * auto-accepted: it always goes to review, because it may be a late/early post of that caption
   * or a different caption entirely. Default 1; 0 restores the strict same-day rule.
   */
  adjacentDays?: number;
  timeZone?: string; // default Asia/Kolkata
}

export const DEFAULT_ADJACENT_DAYS = 1;

export const DEFAULT_MATCH_TIME_ZONE = "Asia/Kolkata";

/** Calendar day (YYYY-MM-DD) of an instant in the given time zone. */
export function calendarDay(
  value: string | Date,
  timeZone: string = DEFAULT_MATCH_TIME_ZONE
): string | null {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export type MatchResult =
  | {
      matched: true;
      tier: "tier1_exact";
      confidence: 1.0;
      captionId: string;
      normalizedCaption: string;
      captionHash: string;
      needsReview: false;
      isAmbiguous?: boolean;
      alternativeCaptionId?: string;
      matchedSegment?: "full" | "core_body";
    }
  | {
      matched: true;
      /**
       * Tier 1D: the campaign text is identical once the volunteer's greeting, hashtags and
       * sign-off are stripped. Auto-accepted, but recorded separately from word-for-word matches.
       */
      tier: "tier1_core";
      confidence: 0.99;
      captionId: string;
      normalizedCaption: string;
      captionHash: string;
      needsReview: false;
      isAmbiguous?: boolean;
      alternativeCaptionId?: string;
      matchedSegment: "core_body";
    }
  | {
      matched: true;
      tier: "manual_approved";
      confidence: 1.0;
      captionId: string;
      normalizedCaption: string;
      captionHash: string;
      needsReview: false;
      isAmbiguous?: boolean;
      alternativeCaptionId?: string;
    }
  | {
      matched: true;
      tier: "tier2_fuzzy";
      confidence: number;
      captionId: string;
      normalizedCaption: string;
      captionHash: string;
      needsReview: true;
      isAmbiguous?: boolean;
      alternativeCaptionId?: string;
      matchedSegment?: "full" | "core_body" | "paragraph";
      appliedThreshold?: number;
      /**
       * Set when the caption was released on a neighbouring day (-1 = the day before the post,
       * +1 = the day after). Always needs review, whatever the text similarity.
       */
      adjacentDayOffset?: number;
    }
  | {
      matched: false;
      reason:
        | "empty_caption"
        | "no_active_captions"
        | "below_similarity_threshold"
        | "outside_embargo_window";
      normalizedCaption?: string;
      highestScore?: number;
      thresholdRequired?: number;
      /** Closest caption that was tried, even though it scored too low (near-miss diagnostics). */
      bestCaptionId?: string;
    };

export type MatchReason =
  | "exact"
  | "core"
  | "variant"
  | "fuzzy"
  | "adjacent_day"
  | "below_threshold"
  | "outside_window"
  | "empty_caption"
  | "no_active_captions";

/** Why a post got its label, stored on the post so a missed match can be audited later. */
export interface MatchDiagnostics {
  reason: MatchReason;
  /** Similarity to the closest caption tried (0-1), when one was compared. */
  score: number | null;
  /** The closest caption tried: the match for matched posts, the near-miss for unmatched ones. */
  bestCaptionId: string | null;
}

export function describeMatch(result: MatchResult): MatchDiagnostics {
  if (result.matched) {
    const reason: MatchReason =
      result.tier === "tier1_exact"
        ? "exact"
        : result.tier === "tier1_core"
          ? "core"
          : result.tier === "manual_approved"
            ? "variant"
            : result.adjacentDayOffset !== undefined
              ? "adjacent_day"
              : "fuzzy";
    return { reason, score: result.confidence, bestCaptionId: result.captionId };
  }
  const reason: MatchReason =
    result.reason === "below_similarity_threshold"
      ? "below_threshold"
      : result.reason === "outside_embargo_window"
        ? "outside_window"
        : result.reason;
  return {
    reason,
    score: result.highestScore ?? null,
    bestCaptionId: result.bestCaptionId ?? null,
  };
}

export const FUZZY_SIMILARITY_THRESHOLD = 0.9;
export const DEFAULT_EMBARGO_TOLERANCE_HOURS = 48;

/**
 * Calculates adaptive similarity threshold based on canonical caption word count:
 * - Short (<= 10 words): Stricter threshold (0.94) to prevent false positives from generic personal posts.
 * - Medium (11-45 words): Standard threshold (0.89) balancing precision and recall.
 * - Long (> 45 words): Forgiving threshold (0.84) to accommodate partial quoting or bilingual text.
 */
export function getAdaptiveThreshold(
  wordCount: number,
  options?: AdaptiveThresholdOptions
): number {
  if (wordCount <= 10) {
    return options?.shortThreshold ?? 0.94;
  }
  if (wordCount <= 45) {
    return options?.mediumThreshold ?? 0.89;
  }
  return options?.longThreshold ?? 0.84;
}

/**
 * Calculates Jaro similarity between two strings s1 and s2.
 * Output is in range [0, 1].
 */
export function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) {
      k++;
    }
    if (s1[i] !== s2[k]) {
      transpositions++;
    }
    k++;
  }

  const m = matches;
  return (m / s1.length + m / s2.length + (m - transpositions / 2) / m) / 3;
}

/**
 * Calculates Jaro-Winkler similarity between two strings.
 * Standard scaling factor p = 0.1, max prefix length = 4.
 */
export function jaroWinklerSimilarity(
  s1: string,
  s2: string,
  prefixScale: number = 0.1
): number {
  const jaro = jaroSimilarity(s1, s2);
  if (jaro <= 0.0) return 0.0;

  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefix++;
    } else {
      break;
    }
  }

  return jaro + prefix * prefixScale * (1 - jaro);
}

/**
 * Calculates Token Overlap and Containment Similarity.
 * Resolves the real-world social media failure modes of Jaro-Winkler:
 * - Prepended greetings ("Namaste friends!", "Good morning,")
 * - Appended local chapter hashtags ("#mumbai #cleanup #youthdrive")
 * - Embedded campaign quotes
 */
export function calculateTokenSimilarity(
  candidate: string,
  canonical: string
): { score: number; isContained: boolean } {
  if (candidate === canonical) return { score: 1.0, isContained: true };
  if (!candidate || !canonical) return { score: 0.0, isContained: false };

  // 1. Direct Substring Containment Check
  // If candidate completely contains canonical (e.g. Greeting + Canonical + Hashtags)
  if (canonical.length >= 20 && candidate.includes(canonical)) {
    const ratio = canonical.length / candidate.length;
    // Base 0.93 for containment + proportional boost based on length ratio
    const score = Math.min(0.99, 0.93 + 0.06 * ratio);
    return { score, isContained: true };
  }

  // If canonical contains candidate (volunteer posted slightly truncated version >= 75% of canonical)
  if (candidate.length >= 20 && canonical.includes(candidate)) {
    const ratio = candidate.length / canonical.length;
    if (ratio >= 0.75) {
      const score = 0.90 + 0.08 * ratio;
      return { score, isContained: true };
    }
  }

  // 2. Word Token Set Overlap
  const tokenizeWords = (text: string) =>
    text
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, ""))
      .filter((w) => w.length > 0);

  const canonTokens = tokenizeWords(canonical);
  const candTokens = tokenizeWords(candidate);

  if (canonTokens.length === 0 || candTokens.length === 0) {
    return { score: 0.0, isContained: false };
  }

  const candSet = new Set(candTokens);
  let matchedCanonTokens = 0;
  for (const token of canonTokens) {
    if (candSet.has(token)) {
      matchedCanonTokens++;
    }
  }

  const canonCoverage = matchedCanonTokens / canonTokens.length;

  // If >= 85% of canonical words are present, and canonical has at least 4 significant words
  if (canonCoverage >= 0.85 && canonTokens.length >= 4) {
    const score = Math.min(0.98, 0.90 + 0.09 * ((canonCoverage - 0.85) / 0.15));
    return { score, isContained: canonCoverage >= 0.95 };
  }

  return { score: 0.0, isContained: false };
}

/**
 * Computes hybrid similarity between a candidate caption and a canonical caption.
 * Blends Jaro-Winkler with token containment to prevent false-negative discards.
 */
export function computeCaptionSimilarity(
  candidate: string,
  canonical: string
): number {
  if (candidate === canonical) return 1.0;

  const jw = jaroWinklerSimilarity(candidate, canonical);
  const token = calculateTokenSimilarity(candidate, canonical);

  return Math.max(jw, token.score);
}

/**
 * Extracts and cleans URLs for security and integrity verification.
 * Compares hostname and pathname (case-insensitive, trailing slash trimmed).
 */
export function extractCleanUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s]+/gi) || [];
  return matches.map((u) => {
    const clean = u.replace(/[.,!?:;)\]'"]+$/, "");
    try {
      const parsed = new URL(clean);
      return (parsed.hostname + parsed.pathname).toLowerCase().replace(/\/+$/, "");
    } catch {
      return clean.toLowerCase().replace(/\/+$/, "");
    }
  });
}

export function urlsMatch(textA: string, textB: string): boolean {
  const urlsA = extractCleanUrls(textA);
  const urlsB = extractCleanUrls(textB);
  if (urlsA.length === 0 && urlsB.length === 0) return true;
  if (urlsA.length !== urlsB.length) return false;
  return urlsA.every((u, i) => u === urlsB[i]);
}

/**
 * Executes the two-tier caption matching pipeline:
 * - Tier 1A: Exact Normalized-Caption Hash match (SHA-256)
 * - Tier 1B: Exact Hash match against approved variants
 * - Tier 2: Hybrid similarity match (Jaro-Winkler + Token Containment >= 0.90) routed to review queue
 * - Below 0.90: Discard immediately (zero storage)
 * - Optional: Temporal validation guarding against pre-campaign post matching
 */
export function matchCaption(
  rawCaption: string | null | undefined,
  activeCaptions: MatchableCaption[],
  approvedVariants: MatchableVariant[] = [],
  options?: MatchCaptionOptions
): MatchResult {
  if (!rawCaption || rawCaption.trim().length === 0) {
    return { matched: false, reason: "empty_caption" };
  }

  if (!activeCaptions || activeCaptions.length === 0) {
    return { matched: false, reason: "no_active_captions" };
  }

  // Filter captions by release date if the post timestamp is provided
  let eligibleCaptions = activeCaptions;
  // Captions of the neighbouring days (soft window), tried only when no same-day caption matches.
  const adjacent: Array<{ caption: MatchableCaption; offset: number }> = [];
  if (options?.postedAt) {
    const postTime = new Date(options.postedAt).getTime();
    if (!isNaN(postTime)) {
      const toleranceMs =
        (options.embargoToleranceHours ?? DEFAULT_EMBARGO_TOLERANCE_HOURS) *
        60 *
        60 *
        1000;

      const postDay = options.sameDayOnly
        ? calendarDay(options.postedAt, options.timeZone)
        : null;
      const maxOffset = Math.max(0, options.adjacentDays ?? DEFAULT_ADJACENT_DAYS);

      eligibleCaptions = activeCaptions.filter((caption) => {
        if (!caption.released_at) return true;
        const releaseTime = new Date(caption.released_at).getTime();
        if (isNaN(releaseTime)) return true;
        if (options.sameDayOnly && postDay) {
          const releaseDay = calendarDay(caption.released_at, options.timeZone);
          if (releaseDay === postDay) return true;
          const offset = releaseDay ? dayDifference(postDay, releaseDay) : null;
          if (offset !== null && offset !== 0 && Math.abs(offset) <= maxOffset) {
            adjacent.push({ caption, offset });
          }
          return false;
        }
        // Post must not have been published earlier than (released_at - tolerance)
        return postTime >= releaseTime - toleranceMs;
      });

      if (eligibleCaptions.length === 0 && adjacent.length === 0) {
        return { matched: false, reason: "outside_embargo_window" };
      }
    }
  }

  const first =
    eligibleCaptions.length > 0
      ? matchAgainst(rawCaption, eligibleCaptions, approvedVariants, options)
      : null;
  if (first?.matched) return first;
  if (adjacent.length === 0) {
    return first ?? { matched: false, reason: "outside_embargo_window" };
  }

  // No same-day caption matched: look at the neighbouring days. A hit is never trusted blindly.
  const second = matchAgainst(
    rawCaption,
    adjacent.map((a) => a.caption),
    approvedVariants,
    options
  );
  if (second.matched) {
    const offset = adjacent.find((a) => a.caption.id === second.captionId)?.offset ?? 0;
    return {
      matched: true,
      tier: "tier2_fuzzy",
      confidence: second.confidence,
      captionId: second.captionId,
      normalizedCaption: second.normalizedCaption,
      captionHash: second.captionHash,
      needsReview: true,
      isAmbiguous: second.isAmbiguous,
      alternativeCaptionId: second.alternativeCaptionId,
      matchedSegment: second.tier === "manual_approved" ? "full" : second.matchedSegment,
      appliedThreshold: second.tier === "tier2_fuzzy" ? second.appliedThreshold : undefined,
      adjacentDayOffset: offset,
    };
  }

  // Both lookups missed: report the closer near-miss.
  if (!first) return second;
  const firstScore = first.matched ? 0 : first.highestScore ?? 0;
  const secondScore = second.matched ? 0 : second.highestScore ?? 0;
  return secondScore > firstScore ? second : first;
}

/** A core text worth trusting for an auto-match: not a few words or a caption that is mostly hashtags. */
const MIN_CORE_CHARS = 15;
const MIN_CORE_WORDS = 4;
function isSubstantialCore(core: string): boolean {
  return core.length >= MIN_CORE_CHARS && countWords(core) >= MIN_CORE_WORDS;
}

/** Whole days from `fromDay` to `toDay` (both YYYY-MM-DD): positive when toDay is later. Here: caption day minus post day. */
function dayDifference(fromDay: string, toDay: string): number | null {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** The matching pipeline (tiers 1A-2) against an already-filtered set of captions. */
function matchAgainst(
  rawCaption: string,
  eligibleCaptions: MatchableCaption[],
  approvedVariants: MatchableVariant[],
  options?: MatchCaptionOptions
): MatchResult {
  const normalized = normalizeCaption(rawCaption);
  const hash = computeCaptionHash(normalized);

  // --- Tier 1A: Exact hash match against active canonical captions ---
  const exactMatch = eligibleCaptions.find((c) => c.caption_hash === hash);
  if (exactMatch && urlsMatch(rawCaption, exactMatch.canonical_caption)) {
    return {
      matched: true,
      tier: "tier1_exact",
      confidence: 1.0,
      captionId: exactMatch.id,
      normalizedCaption: normalized,
      captionHash: hash,
      needsReview: false,
    };
  }

  // --- Tier 1B: Exact hash match against previously approved variants ---
  const eligibleCaptionIds = new Set(eligibleCaptions.map((c) => c.id));
  const variantMatch = approvedVariants.find(
    (v) => v.variant_hash === hash && eligibleCaptionIds.has(v.caption_id)
  );
  if (variantMatch) {
    const parentCap = eligibleCaptions.find((c) => c.id === variantMatch.caption_id);
    if (!parentCap || urlsMatch(rawCaption, parentCap.canonical_caption)) {
      return {
        matched: true,
        tier: "manual_approved",
        confidence: 1.0,
        captionId: variantMatch.caption_id,
        normalizedCaption: normalized,
        captionHash: hash,
        needsReview: false,
      };
    }
  }

  // --- Tier 1C: Exact Semantic Content Match (Punctuation & Newline Tolerant) ---
  // When a volunteer publishes the distributed content with identical words and order,
  // but with minor punctuation variations (! vs ., commas, quotes) or internal
  // line-break differences (\n vs spaces from copy-paste/mobile text wrapping),
  // this is an exact match for the campaign and must NOT drop into human review.
  const candidateContent = normalizeContentText(normalized);
  if (candidateContent.length > 0) {
    const contentMatch = eligibleCaptions.find(
      (c) => normalizeContentText(c.normalized_caption) === candidateContent
    );
    if (contentMatch && urlsMatch(rawCaption, contentMatch.canonical_caption)) {
      return {
        matched: true,
        tier: "tier1_exact",
        confidence: 1.0,
        captionId: contentMatch.id,
        normalizedCaption: normalized,
        captionHash: hash,
        needsReview: false,
      };
    }
  }

  // --- Tier 1D: identical core text inside a greeting / hashtags / sign-off wrapper ---
  // Volunteers very often add "Namaste friends!" or local hashtags around the supplied text. When
  // the campaign text itself is unchanged this is as certain as an exact match, so it must not
  // flood the review queue. Guards: the core must be substantial, exactly ONE eligible caption
  // may share it (otherwise which caption was meant is a human call), and links must be identical.
  const candidateSections = segmentCaption(normalized);
  const candidateCore = normalizeContentText(candidateSections.cleanBody);
  if (isSubstantialCore(candidateCore)) {
    const coreMatches = eligibleCaptions.filter(
      (c) => normalizeContentText(segmentCaption(c.normalized_caption).cleanBody) === candidateCore
    );
    if (coreMatches.length === 1 && urlsMatch(rawCaption, coreMatches[0].canonical_caption)) {
      return {
        matched: true,
        tier: "tier1_core",
        confidence: 0.99,
        captionId: coreMatches[0].id,
        normalizedCaption: normalized,
        captionHash: hash,
        needsReview: false,
        matchedSegment: "core_body",
      };
    }
  }

  // --- Tier 2: Section-Segmented Hybrid Matching with Dynamic/Adaptive Thresholding ---

  let bestScore = 0;
  let bestCaption: MatchableCaption | null = null;
  let bestThreshold = FUZZY_SIMILARITY_THRESHOLD;
  let bestSegment: "full" | "core_body" | "paragraph" = "full";

  let runnerUpScore = 0;
  let runnerUpCaption: MatchableCaption | null = null;
  let runnerUpThreshold = FUZZY_SIMILARITY_THRESHOLD;

  for (const caption of eligibleCaptions) {
    const canonSections = segmentCaption(caption.normalized_caption);
    const canonWordCount = canonSections.wordCount || countWords(caption.normalized_caption);
    const threshold = getAdaptiveThreshold(canonWordCount, options?.adaptiveThresholds);

    // 1. Full-string similarity (Jaro-Winkler + Token Containment)
    const simFull = computeCaptionSimilarity(normalized, caption.normalized_caption);

    // 2. Section clean-body similarity (comparing core campaign text without greetings/hashtags)
    const simBody = computeCaptionSimilarity(candidateSections.cleanBody, canonSections.cleanBody);

    // 3. Cross-boundary similarities (candidate core vs full canonical, candidate full vs canonical core)
    const simCandBodyVsCanon = computeCaptionSimilarity(
      candidateSections.cleanBody,
      caption.normalized_caption
    );
    const simCandVsCanonBody = computeCaptionSimilarity(
      normalized,
      canonSections.cleanBody
    );

    let pairScore = Math.max(simFull, simBody, simCandBodyVsCanon, simCandVsCanonBody);
    let pairSegment: "full" | "core_body" | "paragraph" =
      pairScore === simBody || pairScore === simCandBodyVsCanon || pairScore === simCandVsCanonBody
        ? "core_body"
        : "full";

    // 4. Exact Core Body Match Boost:
    // If volunteer copied the exact campaign text but wrapped it in personal greetings and hashtags
    if (
      candidateSections.cleanBody === canonSections.cleanBody &&
      canonSections.cleanBody.length >= 15
    ) {
      if (pairScore < 0.99) {
        pairScore = 0.99;
        pairSegment = "core_body";
      }
    }

    // 5. Long Caption Paragraph Containment (> 45 words):
    // If canonical is a multi-paragraph campaign statement, check if any major paragraph matches
    if (canonWordCount > 45) {
      const paragraphs = caption.normalized_caption.split(/\n\n+/);
      for (const p of paragraphs) {
        if (countWords(p) >= 12) {
          const pScore = Math.max(
            computeCaptionSimilarity(candidateSections.cleanBody, p),
            computeCaptionSimilarity(normalized, p)
          );
          if (pScore > pairScore) {
            pairScore = pScore;
            pairSegment = "paragraph";
          }
        }
      }
    }

    if (pairScore > bestScore) {
      runnerUpScore = bestScore;
      runnerUpCaption = bestCaption;
      runnerUpThreshold = bestThreshold;

      bestScore = pairScore;
      bestCaption = caption;
      bestThreshold = threshold;
      bestSegment = pairSegment;
    } else if (pairScore > runnerUpScore) {
      runnerUpScore = pairScore;
      runnerUpCaption = caption;
      runnerUpThreshold = threshold;
    }
  }

  if (bestCaption && bestScore >= bestThreshold) {
    const roundedConfidence = Math.round(bestScore * 10000) / 10000;
    const isAmbiguous =
      runnerUpCaption !== null &&
      runnerUpScore >= runnerUpThreshold &&
      bestScore - runnerUpScore < 0.05;

    return {
      matched: true,
      tier: "tier2_fuzzy",
      confidence: roundedConfidence,
      captionId: bestCaption.id,
      normalizedCaption: normalized,
      captionHash: hash,
      needsReview: true,
      isAmbiguous,
      alternativeCaptionId: isAmbiguous && runnerUpCaption ? runnerUpCaption.id : undefined,
      matchedSegment: bestSegment,
      appliedThreshold: bestThreshold,
    };
  }

  return {
    matched: false,
    reason: "below_similarity_threshold",
    normalizedCaption: normalized,
    highestScore: Math.round(bestScore * 10000) / 10000,
    thresholdRequired: bestThreshold,
    bestCaptionId: bestCaption?.id,
  };
}
