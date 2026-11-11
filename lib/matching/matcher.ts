import {
  normalizeCaption,
  computeCaptionHash,
  segmentCaption,
  countWords,
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
  embargoToleranceHours?: number; // default 48 hours
  adaptiveThresholds?: AdaptiveThresholdOptions;
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
    };

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
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
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

  // Filter captions by release date embargo if post timestamp is provided
  let eligibleCaptions = activeCaptions;
  if (options?.postedAt) {
    const postTime = new Date(options.postedAt).getTime();
    if (!isNaN(postTime)) {
      const toleranceMs =
        (options.embargoToleranceHours ?? DEFAULT_EMBARGO_TOLERANCE_HOURS) *
        60 *
        60 *
        1000;

      eligibleCaptions = activeCaptions.filter((caption) => {
        if (!caption.released_at) return true;
        const releaseTime = new Date(caption.released_at).getTime();
        if (isNaN(releaseTime)) return true;
        // Post must not have been published earlier than (released_at - tolerance)
        return postTime >= releaseTime - toleranceMs;
      });

      if (eligibleCaptions.length === 0) {
        return { matched: false, reason: "outside_embargo_window" };
      }
    }
  }

  const normalized = normalizeCaption(rawCaption);
  const hash = computeCaptionHash(normalized);

  // --- Tier 1A: Exact hash match against active canonical captions ---
  const exactMatch = eligibleCaptions.find((c) => c.caption_hash === hash);
  if (exactMatch) {
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

  // --- Tier 2: Section-Segmented Hybrid Matching with Dynamic/Adaptive Thresholding ---
  const candidateSections = segmentCaption(normalized);

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
  };
}
