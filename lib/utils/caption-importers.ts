/**
 * Utility functions for parsing and validating bulk campaign caption imports.
 * Supports:
 * 1. Standard CSV (including quoted multiline cells from Excel/Sheets)
 * 2. Multi-block delimiter-separated text (e.g., delimited by '---' or '===')
 */

import { processCaption } from "../matching/normalizer.ts";

export interface ParsedCaptionItem {
  id: string; // Temporary client-side UUID/key
  title: string;
  canonicalCaption: string;
  releasedAt?: string;
  wordCount: number;
  hash: string;
  normalized: string;
  status: "valid" | "duplicate_in_batch" | "invalid";
  errorMessage?: string;
}

export interface ParseResult {
  items: ParsedCaptionItem[];
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
}

/**
 * Robust RFC 4180-compliant CSV parser that supports:
 * - Quoted fields with embedded commas
 * - Embedded newlines inside quotes
 * - Escaped double quotes ("")
 * - Comma or Tab delimiter autodetection
 */
export function parseCSVToRows(csvText: string): string[][] {
  const rows: string[][] = [];
  if (!csvText || !csvText.trim()) return rows;

  // Autodetect delimiter (Tab vs Comma)
  const firstLine = csvText.split(/\r?\n/)[0] || "";
  const delimiter = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";

  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped double quote
        currentField += '"';
        i += 2;
      } else if (char === '"') {
        // Closing quote
        inQuotes = false;
        i++;
      } else {
        currentField += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = "";
        i++;
      } else if (char === "\r" && nextChar === "\n") {
        currentRow.push(currentField.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        i += 2;
      } else if (char === "\n" || char === "\r") {
        currentRow.push(currentField.trim());
        if (currentRow.some((c) => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
        i++;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Flush remaining field
  currentRow.push(currentField.trim());
  if (currentRow.some((c) => c.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Parses CSV/Excel export string into structured, pre-validated caption items.
 * Looks for headers like: title, caption (or canonical_caption), released_at (or date).
 */
export function parseCaptionsCSV(csvText: string): ParseResult {
  const rows = parseCSVToRows(csvText);
  if (rows.length === 0) {
    return { items: [], validCount: 0, duplicateCount: 0, invalidCount: 0 };
  }

  // Detect header indices
  const headerRow = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  let titleIdx = headerRow.findIndex((h) => h.includes("title") || h.includes("name") || h.includes("headline"));
  let captionIdx = headerRow.findIndex(
    (h) => h.includes("caption") || h.includes("content") || h.includes("text") || h.includes("message")
  );
  let dateIdx = headerRow.findIndex(
    (h) => h.includes("release") || h.includes("date") || h.includes("time") || h.includes("schedule")
  );

  let dataRows = rows.slice(1);

  // Fallback if no recognizable header is found
  if (titleIdx === -1 && captionIdx === -1) {
    titleIdx = 0;
    captionIdx = 1;
    dateIdx = rows[0].length > 2 ? 2 : -1;
    dataRows = rows; // treat first row as data
  } else if (titleIdx === -1 && captionIdx !== -1) {
    titleIdx = captionIdx === 0 ? 1 : 0;
  } else if (captionIdx === -1 && titleIdx !== -1) {
    captionIdx = titleIdx === 0 ? 1 : 0;
  }

  const items: ParsedCaptionItem[] = [];
  const seenHashes = new Set<string>();

  dataRows.forEach((row, idx) => {
    if (!row || row.length === 0 || row.every((c) => !c.trim())) return;

    const rawTitle = (row[titleIdx] || "").trim();
    const rawCaption = (row[captionIdx] || "").trim();
    const rawDate = dateIdx !== -1 && row[dateIdx] ? row[dateIdx].trim() : undefined;

    const parsed = processParsedItem(rawTitle, rawCaption, rawDate, idx + 1, seenHashes);
    items.push(parsed);
  });

  return summarizeItems(items);
}

/**
 * Parses multi-block plain text separated by '---' or '==='.
 * Supports explicit tags:
 *   Title: My Campaign Title
 *   Caption: My caption text goes here
 *   Date: 2026-11-12
 * Or implicit fallback: first line is Title, remaining lines are Caption.
 */
export function parseMultiBlockText(rawText: string): ParseResult {
  if (!rawText || !rawText.trim()) {
    return { items: [], validCount: 0, duplicateCount: 0, invalidCount: 0 };
  }

  // Split on block delimiters (--- or === with optional whitespace on its own line)
  const blocks = rawText
    .split(/(?:^|\n)\s*(?:---|===)\s*(?:\n|$)/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const items: ParsedCaptionItem[] = [];
  const seenHashes = new Set<string>();

  blocks.forEach((block, idx) => {
    let title = "";
    let caption = "";
    let releasedAt: string | undefined = undefined;

    // Check for explicit "Title:" and "Caption:" tags
    const titleMatch = block.match(/^(?:title|identifier|heading|नाम|शीर्षक)\s*:\s*(.+)$/im);
    const dateMatch = block.match(/^(?:date|released_at|release|तारीख|दिनांक)\s*:\s*(.+)$/im);
    const captionMatch = block.match(/^(?:caption|text|content|body|संदेश|कैप्शन)\s*:\s*([\s\S]+)$/im);

    if (titleMatch && captionMatch) {
      title = titleMatch[1].trim();
      caption = captionMatch[1].trim();
      if (dateMatch) releasedAt = dateMatch[1].trim();
    } else {
      // Implicit format: First line is title, remaining lines are caption
      const lines = block.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length === 1) {
        title = lines[0].slice(0, 40) + "...";
        caption = lines[0];
      } else if (lines.length > 1) {
        title = lines[0];
        caption = lines.slice(1).join("\n").trim();
      }
    }

    const parsed = processParsedItem(title, caption, releasedAt, idx + 1, seenHashes);
    items.push(parsed);
  });

  return summarizeItems(items);
}

/**
 * Normalizes, hashes, and validates a parsed item.
 */
function processParsedItem(
  title: string,
  caption: string,
  dateStr: string | undefined,
  rowNumber: number,
  seenHashes: Set<string>
): ParsedCaptionItem {
  const id = `item-${rowNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!title && !caption) {
    return {
      id,
      title: `Row #${rowNumber}`,
      canonicalCaption: "",
      wordCount: 0,
      hash: "",
      normalized: "",
      status: "invalid",
      errorMessage: "Both Title and Caption are empty.",
    };
  }

  if (!title) {
    title = caption.slice(0, 35) + "...";
  }

  if (!caption) {
    return {
      id,
      title,
      canonicalCaption: "",
      wordCount: 0,
      hash: "",
      normalized: "",
      status: "invalid",
      errorMessage: "Caption text cannot be empty.",
    };
  }

  const { normalized, hash } = processCaption(caption);
  const words = normalized.split(/\s+/).filter(Boolean).length;

  let releasedAt: string | undefined = undefined;
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      releasedAt = d.toISOString();
    }
  }

  // Check for duplicate hash within current batch
  if (seenHashes.has(hash)) {
    return {
      id,
      title,
      canonicalCaption: caption,
      releasedAt,
      wordCount: words,
      hash,
      normalized,
      status: "duplicate_in_batch",
      errorMessage: "Identical caption text already present earlier in this batch.",
    };
  }

  seenHashes.add(hash);

  return {
    id,
    title,
    canonicalCaption: caption,
    releasedAt,
    wordCount: words,
    hash,
    normalized,
    status: "valid",
  };
}

function summarizeItems(items: ParsedCaptionItem[]): ParseResult {
  const validCount = items.filter((i) => i.status === "valid").length;
  const duplicateCount = items.filter((i) => i.status === "duplicate_in_batch").length;
  const invalidCount = items.filter((i) => i.status === "invalid").length;

  return {
    items,
    validCount,
    duplicateCount,
    invalidCount,
  };
}

/**
 * Returns a ready-to-download sample CSV template string.
 */
export function getSampleCSVTemplate(): string {
  return `title,caption,release_date
"Tree Plantation Drive 2026","Join us this Sunday for our Tree Planting Drive! Bring gloves and water bottles. #GreenIndia",2026-11-15
"Swachhata Seva Campaign","स्वच्छता ही सेवा अभियान में जुड़ें! आइए अपने आसपास के क्षेत्रों को स्वच्छ बनाएं। #CleanIndia",2026-11-15
"National Youth Conclave","Excited to announce the National Youth Skill Conclave 2026. Register today at https://skillsindia.org/register #SkillIndia",2026-11-20
`;
}
