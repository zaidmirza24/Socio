import type { PlatformType } from "../../types/database.ts";

/**
 * Day-first caption coverage: for ONE day, which volunteer has posted which of that day's
 * captions on which platform. Pure functions only (no database), so they are unit-tested against
 * fixtures; lib/supabase/matrix.ts loads the rows and calls these.
 */

export const COVERAGE_PLATFORMS: readonly PlatformType[] = ["instagram", "facebook", "x"];

/**
 * - POSTED        a post matched this caption
 * - NEEDS_REVIEW  a close match is waiting for an admin decision
 * - POSTED_OTHER  the account posted that day but nothing matched: check it (maybe a miss)
 * - NOT_POSTED    no post from the account that day
 * - NO_ACCESS     the account returned no data (is_visible = false); this does not prove it is private
 */
export type DayCellStatus = "POSTED" | "NEEDS_REVIEW" | "POSTED_OTHER" | "NOT_POSTED" | "NO_ACCESS";

export interface DayCell {
  status: DayCellStatus;
  /** POSTED: the matched post. */
  url?: string;
  /** POSTED: how many posts matched this caption (usually 1). POSTED_OTHER: unmatched posts that day. */
  count?: number;
  /** NEEDS_REVIEW: the review item to open. */
  reviewId?: string;
  /** POSTED_OTHER: one of the unmatched posts scored close to THIS caption (see posts.match_score). */
  nearMiss?: boolean;
}

export interface CoverageAccount {
  id: string;
  handle: string;
  volunteerName: string;
  volunteerId: string | null;
  platform: PlatformType;
  isVisible: boolean;
}

export interface CoverageCaption {
  id: string;
  title: string;
  canonicalCaption: string;
  releasedAt: string;
}

/** The slice of a stored post the coverage needs. */
export interface CoveragePost {
  accountId: string;
  url: string;
  matchStatus: string;
  matchedCaptionId: string | null;
  matchScore: number | null;
  bestCaptionId: string | null;
  /** Posted on the viewed (IST) day, as opposed to matched to a caption of that day later. */
  postedOnDay: boolean;
}

export interface DayRowAccount {
  accountId: string;
  handle: string;
  isVisible: boolean;
}

export interface DayVolunteerRow {
  /** Stable React key. */
  key: string;
  volunteerId: string | null;
  name: string;
  accounts: Partial<Record<PlatformType, DayRowAccount>>;
  /** captionId -> platform -> cell. A platform with no account has no cell (not a miss). */
  cells: Record<string, Partial<Record<PlatformType, DayCell>>>;
}

/** Score from which an unmatched post counts as "close to" a caption (same as the Possible matches lane). */
export const NEAR_MISS_MIN_SCORE = 0.6;

export function buildDayRows(
  accounts: CoverageAccount[],
  captions: CoverageCaption[],
  posts: CoveragePost[],
  /** `${accountId}:${captionId}` -> pending review item id */
  reviewIds: ReadonlyMap<string, string>
): DayVolunteerRow[] {
  const postsByAccount = new Map<string, CoveragePost[]>();
  for (const p of posts) {
    const list = postsByAccount.get(p.accountId) ?? [];
    list.push(p);
    postsByAccount.set(p.accountId, list);
  }

  const rows = new Map<string, DayVolunteerRow>();
  for (const account of accounts) {
    let key = account.volunteerId ?? `acct:${account.id}`;
    let row = rows.get(key);
    // Legacy data: two accounts of one platform for one volunteer. Show the extra one on its own row
    // instead of silently dropping it.
    if (row && row.accounts[account.platform]) {
      key = `${key}:${account.id}`;
      row = undefined;
    }
    if (!row) {
      row = { key, volunteerId: account.volunteerId, name: account.volunteerName, accounts: {}, cells: {} };
      for (const c of captions) row.cells[c.id] = {};
      rows.set(key, row);
    }
    row.accounts[account.platform] = { accountId: account.id, handle: account.handle, isVisible: account.isVisible };

    const mine = postsByAccount.get(account.id) ?? [];
    const unmatchedToday = mine.filter((p) => p.postedOnDay && p.matchStatus === "unmatched");

    for (const caption of captions) {
      const matched = mine.filter((p) => p.matchStatus === "matched" && p.matchedCaptionId === caption.id);
      const review = mine.find((p) => p.matchStatus === "needs_review" && p.matchedCaptionId === caption.id);

      let cell: DayCell;
      if (matched.length > 0) {
        cell = { status: "POSTED", url: matched[0].url, count: matched.length };
      } else if (review) {
        cell = { status: "NEEDS_REVIEW", reviewId: reviewIds.get(`${account.id}:${caption.id}`) };
      } else if (!account.isVisible) {
        cell = { status: "NO_ACCESS" };
      } else if (unmatchedToday.length > 0) {
        cell = {
          status: "POSTED_OTHER",
          count: unmatchedToday.length,
          nearMiss: unmatchedToday.some(
            (p) => p.bestCaptionId === caption.id && (p.matchScore ?? 0) >= NEAR_MISS_MIN_SCORE
          ),
        };
      } else {
        cell = { status: "NOT_POSTED" };
      }
      row.cells[caption.id][account.platform] = cell;
    }
  }

  return Array.from(rows.values());
}

export interface CoverageCount {
  expected: number;
  posted: number;
}

export interface CoverageSummary {
  byPlatform: Record<PlatformType, CoverageCount>;
  byCaption: Record<string, CoverageCount>;
  overall: CoverageCount;
  counts: Record<DayCellStatus, number>;
}

/** Totals over the given rows. Platforms the volunteer has no account on are never "expected". */
export function summarizeCoverage(
  rows: readonly DayVolunteerRow[],
  captions: readonly CoverageCaption[],
  platforms: readonly PlatformType[] = COVERAGE_PLATFORMS
): CoverageSummary {
  const byPlatform = { instagram: { expected: 0, posted: 0 }, facebook: { expected: 0, posted: 0 }, x: { expected: 0, posted: 0 } };
  const byCaption: Record<string, CoverageCount> = {};
  for (const c of captions) byCaption[c.id] = { expected: 0, posted: 0 };
  const counts: Record<DayCellStatus, number> = { POSTED: 0, NEEDS_REVIEW: 0, POSTED_OTHER: 0, NOT_POSTED: 0, NO_ACCESS: 0 };
  const overall: CoverageCount = { expected: 0, posted: 0 };

  for (const row of rows) {
    for (const c of captions) {
      for (const platform of platforms) {
        const cell = row.cells[c.id]?.[platform];
        if (!cell) continue;
        counts[cell.status]++;
        byPlatform[platform].expected++;
        byCaption[c.id].expected++;
        overall.expected++;
        if (cell.status === "POSTED") {
          byPlatform[platform].posted++;
          byCaption[c.id].posted++;
          overall.posted++;
        }
      }
    }
  }
  return { byPlatform, byCaption, overall, counts };
}

/** One volunteer's progress over the shown platforms: posted cells out of the cells that apply. */
export function rowProgress(
  row: DayVolunteerRow,
  captions: readonly CoverageCaption[],
  platforms: readonly PlatformType[] = COVERAGE_PLATFORMS
): CoverageCount {
  const out: CoverageCount = { expected: 0, posted: 0 };
  for (const c of captions) {
    for (const platform of platforms) {
      const cell = row.cells[c.id]?.[platform];
      if (!cell) continue;
      out.expected++;
      if (cell.status === "POSTED") out.posted++;
    }
  }
  return out;
}

/** Day (YYYY-MM-DD) before / after `day` among `days`, or null. `days` need not be sorted. */
export function neighbourDays(days: readonly string[], day: string): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;
  for (const d of days) {
    if (d < day && (prev === null || d > prev)) prev = d;
    if (d > day && (next === null || d < next)) next = d;
  }
  return { prev, next };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A valid `YYYY-MM-DD` query value, or null. */
export function parseDay(raw: string | undefined | null): string | null {
  if (!raw || !DAY_RE.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : raw;
}

/** [start, end) of an IST calendar day as ISO instants. */
export function istDayRange(day: string): { start: string; end: string } {
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}
