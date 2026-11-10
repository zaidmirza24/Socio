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
 * Computes the SHA-256 hexadecimal digest of the given string.
 */
export function computeCaptionHash(normalizedCaption: string): string {
  return createHash("sha256").update(normalizedCaption, "utf8").digest("hex");
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
