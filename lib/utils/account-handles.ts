export type AccountPlatform = "instagram" | "facebook" | "x";

/**
 * Extracts a clean, lower-cased handle from a raw string or profile URL and auto-detects
 * the platform from the URL when one is given; otherwise `defaultPlatform` is kept.
 */
export function extractHandleAndPlatform(
  raw: string,
  defaultPlatform: AccountPlatform = "instagram"
): { handle: string; platform: AccountPlatform } {
  let text = raw.trim();
  let detectedPlatform = defaultPlatform;

  if (/instagram\.com/i.test(text)) {
    detectedPlatform = "instagram";
    text = text.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").split(/[?#]/)[0];
  } else if (/facebook\.com/i.test(text)) {
    detectedPlatform = "facebook";
    text = text.replace(/^https?:\/\/(www\.)?facebook\.com\//i, "").split(/[?#]/)[0];
    if (/profile\.php/i.test(text) && raw.includes("id=")) {
      const match = raw.match(/id=([0-9]+)/);
      if (match) text = match[1];
    }
  } else if (/(twitter\.com|x\.com)/i.test(text)) {
    detectedPlatform = "x";
    text = text.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "").split(/[?#]/)[0];
  }

  const cleanHandle = text.replace(/^@+/, "").replace(/\/+$/, "").trim().toLowerCase();
  return { handle: cleanHandle, platform: detectedPlatform };
}
