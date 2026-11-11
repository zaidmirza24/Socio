import { createHash } from "crypto";

/**
 * Normalizes a caption according to the V2 normalization specification:
 * 1. Unicode Canonical Decomposition & Composition (NFKC)
 * 2. Invisible formatting & zero-width character stripping (\u200B-\u200D, \uFEFF, \u200E, \u200F, \u00AD)
 * 3. Extended punctuation normalization:
 *    - Typographic curly quotes and guillemets -> standard ASCII quotes (" and ')
 *    - Smart apostrophes, backticks, acute accents -> standard ASCII apostrophe (')
 *    - Typographic dashes (en-dash, em-dash, minus) -> standard ASCII hyphen (-)
 *    - Bullet markers (•, ▪, ▫, etc.) -> standard ASCII asterisk (*)
 * 4. Platform truncation marker stripping (trailing "... more", "…more", "…", "...")
 * 5. URL tokenization with trailing punctuation preservation:
 *    - Replaces http/https URLs with {{url}} while preserving trailing punctuation (. , ! ? : ; ) ] ')
 * 6. Whitespace & line-break collapsing:
 *    - Replaces Windows (\r\n) and legacy Mac (\r) line breaks with standard UNIX (\n)
 *    - Collapses 3 or more consecutive newlines into a maximum of two newlines (\n\n)
 *    - Collapses horizontal whitespace (spaces, non-breaking spaces, tabs) to a single space
 *    - Trims leading and trailing whitespace from every individual line and the full string
 * 7. Case folding (converts to lowercase)
 */
export function normalizeCaption(raw: string | null | undefined): string {
  if (!raw) return "";

  // 1. Unicode NFKC normalization
  let s = raw.normalize("NFKC");

  // 2. Strip invisible zero-width characters and formatting marks
  s = s.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u00AD]/g, "");

  // 3. Extended punctuation normalization
  // Convert double quotes & guillemets to straight ASCII "
  s = s.replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '"');
  // Convert typographic single quotes, smart apostrophes, backticks, acute accents to '
  s = s.replace(/[\u2018\u2019\u201A\u201B`´]/g, "'");
  // Normalize typographic dashes (en-dash, em-dash, minus, horizontal bar) to -
  s = s.replace(/[\u2013\u2014\u2212\u2015]/g, "-");
  // Normalize bullet markers to *
  s = s.replace(/[\u2022\u25AA\u25AB\u2023\u25CF\u25CB]/g, "*");

  // 4. Platform truncation marker stripping (trailing read-more indicators)
  s = s.replace(/\s*(?:\.\.\.\s*more|…\s*more|…|\.\.\.)\s*$/i, "");

  // 5. URL tokenization (replaces HTTP/HTTPS URLs with {{url}} placeholder, preserving trailing punctuation)
  s = s.replace(/https?:\/\/[^\s]+/gi, (matchedUrl) => {
    const trimmed = matchedUrl.replace(/[.,!?:;)\]'"]+$/, "");
    const trailingPunctuation = matchedUrl.slice(trimmed.length);
    return "{{url}}" + trailingPunctuation;
  });

  // 6. Line-break and horizontal whitespace collapsing
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = s.split("\n").map((line) => line.replace(/[^\S\r\n]+/g, " ").trim());
  s = lines.join("\n");

  // Collapse 3 or more consecutive newlines to maximum 2 newlines (\n\n)
  s = s.replace(/\n{3,}/g, "\n\n");

  // Trim leading/trailing whitespace
  s = s.trim();

  // 7. Case folding
  s = s.toLowerCase();

  return s;
}

/**
 * Structured sections of a social media caption.
 */
export interface CaptionSections {
  raw: string;
  prefix: string;      // Greetings, forward markers, chapter labels
  body: string;        // The core message body
  suffix: string;      // Trailing sign-offs, contacts, links, hashtag clusters
  hashtags: string[];  // All hashtags extracted from the caption
  cleanBody: string;   // Normalized body stripped of hashtags and extra whitespace
  wordCount: number;   // Number of words in cleanBody
}

const GREETING_PATTERN =
  /^(?:namaste|namaskar|hello|hi|hey|dear|good\s+(?:morning|afternoon|evening)|pranam|jai\s+hind|friends|volunteers|team|all|नमस्ते|नमस्कार|प्रणाम|जय\s+हि(?:न्द|ंद)|साथियों|मित्रों)(?:[!:,.\s\u0964\u0965-]|$)/iu;

const FORWARD_HEADER_PATTERN =
  /^(?:\*?forwarded(?:\s+message)?\*?|\[\d{1,2}[\/.-]\d{1,2}.*?\]|\bupdate:|\bannouncement:|\bchapter\s+[^:\n]+:|\bdistrict\s+[^:\n]+:)/i;

const SIGNOFF_PATTERN =
  /^(?:regards|warm\s+regards|thanks|thank\s+you|best\s+wishes|yours\s+truly|signed|volunteer\s+id|contact|call|phone|ph|whatsapp|dm\s+for|reach\s+out\s+at|link\s+in\s+bio|link\s+in\s+story|check\s+bio|swipe\s+up|धन्यवाद|सादर|शुभकामनाएं)\b/iu;

function isPureHashtagLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  return trimmed.split(/\s+/).every((w) => w.startsWith("#"));
}

/**
 * Counts unicode-aware words in a string, preserving Devanagari / Indic marks (\p{M}).
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const tokens = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, ""))
    .filter((w) => w.length > 0);
  return tokens.length;
}

/**
 * Segments a normalized social media caption into prefix, core body, suffix, and hashtags.
 * Handles both multi-line and single-line caption structures across English, Hindi, and regional scripts.
 */
export function segmentCaption(raw: string | null | undefined): CaptionSections {
  if (!raw || raw.trim().length === 0) {
    return {
      raw: "",
      prefix: "",
      body: "",
      suffix: "",
      hashtags: [],
      cleanBody: "",
      wordCount: 0,
    };
  }

  const normalized = normalizeCaption(raw);
  const hashtagMatches = normalized.match(/#[\p{L}\p{M}\p{N}_]+/gu) || [];
  const hashtags = Array.from(new Set(hashtagMatches));

  const lines = normalized.split("\n");
  let prefix = "";
  let suffix = "";
  let body = normalized;

  // 1. Multi-line extraction
  if (lines.length > 1) {
    let startIndex = 0;
    let endIndex = lines.length;

    // Scan top prefix lines (greetings, forward banners)
    while (startIndex < Math.min(2, endIndex - 1)) {
      const line = lines[startIndex].trim();
      if (GREETING_PATTERN.test(line) || FORWARD_HEADER_PATTERN.test(line)) {
        startIndex++;
      } else {
        break;
      }
    }

    // Scan bottom suffix lines (sign-offs, hashtag lines)
    while (endIndex > startIndex + 1) {
      const line = lines[endIndex - 1].trim();
      if (isPureHashtagLine(line) || SIGNOFF_PATTERN.test(line)) {
        endIndex--;
      } else {
        break;
      }
    }

    if (startIndex > 0) {
      prefix = lines.slice(0, startIndex).join("\n").trim();
    }
    if (endIndex < lines.length) {
      suffix = lines.slice(endIndex).join("\n").trim();
    }
    body = lines.slice(startIndex, endIndex).join("\n").trim();
  }

  // 2. Strip trailing inline hashtag cluster from body
  const trailingHashtagRegex = /(?:\s*#[\p{L}\p{M}\p{N}_]+)+$/u;
  const trailingMatch = body.match(trailingHashtagRegex);
  if (trailingMatch) {
    const trailingTags = trailingMatch[0].trim();
    suffix = suffix ? `${trailingTags}\n${suffix}` : trailingTags;
    body = body.slice(0, body.length - trailingMatch[0].length).trim();
  }

  // 3. Strip single-line greeting if prefix is still empty
  if (!prefix) {
    const singleLineGreetingRegex =
      /^((?:namaste|namaskar|hello|hi|hey|dear|good\s+(?:morning|afternoon|evening)|pranam|jai\s+hind|नमस्ते|नमस्कार|प्रणाम|जय\s+हि(?:न्द|ंद)|साथियों|मित्रों)(?:\s+[\p{L}\p{M}\p{N}_]+){0,3}[!:,.\u0964\u0965\-])\s+(.+)$/iu;
    const greetingMatch = body.match(singleLineGreetingRegex);
    if (greetingMatch && greetingMatch[2].length >= 10) {
      prefix = greetingMatch[1].trim();
      body = greetingMatch[2].trim();
    }
  }

  // Fallback if stripping leaves body empty
  if (!body.trim()) {
    body = normalized;
  }

  // 4. Clean body: strip remaining inline hashtags and collapse horizontal spaces
  const cleanBody = body
    .replace(/#[\p{L}\p{M}\p{N}_]+/gu, "")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();

  const finalCleanBody = cleanBody || body;

  return {
    raw: normalized,
    prefix,
    body,
    suffix,
    hashtags,
    cleanBody: finalCleanBody,
    wordCount: countWords(finalCleanBody),
  };
}

/**
 * Computes the SHA-256 hexadecimal digest of the given string.
 */
export function computeCaptionHash(normalizedCaption: string): string {
  return createHash("sha256").update(normalizedCaption, "utf8").digest("hex");
}

/**
 * Normalizes text for exact semantic content matching by stripping punctuation 
 * and collapsing all whitespace (spaces, tabs, newlines) to single spaces.
 * Used to verify if candidate caption has the exact same words and order as canonical caption,
 * regardless of punctuation differences or line-break formatting.
 */
export function normalizeContentText(text: string | null | undefined): string {
  if (!text) return "";
  return normalizeCaption(text)
    // Protect {{url}} token from punctuation stripping
    .replace(/\{\{url\}\}/g, "___URL_PLACEHOLDER___")
    // Strip all Unicode punctuation (periods, commas, exclamation marks, hyphens, quotes, brackets, etc.)
    .replace(/[\p{P}]+/gu, " ")
    // Restore {{url}} placeholder
    .replace(/___URL_PLACEHOLDER___/g, "{{url}}")
    // Collapse all whitespace sequences (spaces, tabs, newlines) into single spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convenience helper that normalizes a raw caption and returns both the normalized text and its SHA-256 hash.
 */
export function processCaption(raw: string | null | undefined): {
  normalized: string;
  hash: string;
} {
  const normalized = normalizeCaption(raw);
  const hash = computeCaptionHash(normalized);
  return { normalized, hash };
}
