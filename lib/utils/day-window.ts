/**
 * "Today" day-window helpers. The campaign operates in IST (UTC+5:30, no DST).
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC instant of 00:00 IST for the IST calendar day that contains `now`. */
export function getIstDayStart(now: Date = new Date()): Date {
  const istMs = now.getTime() + IST_OFFSET_MS;
  const istMidnightMs = Math.floor(istMs / DAY_MS) * DAY_MS;
  return new Date(istMidnightMs - IST_OFFSET_MS);
}

/**
 * Date string (YYYY-MM-DD) to hand to actors as a "newer than" boundary.
 * Actors read a bare date as UTC midnight, so we use the day BEFORE today's IST date; that
 * guarantees posts made 00:00-05:30 IST are not cut off. The exact IST-day cut is applied
 * after fetching by `isPostedOnIstDay`.
 */
export function getScrapeBoundaryDate(now: Date = new Date()): string {
  const prevDayStart = new Date(getIstDayStart(now).getTime() - DAY_MS);
  return new Date(prevDayStart.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Keeps only posts made on today's IST day, and at most `perAccountCap` per account
 * (newest first). Posts with an unparseable date are dropped. Used for daily discovery so the
 * window holds even when an actor ignores its date input (e.g. X).
 */
export function applyDayWindowAndCap<
  T extends { posted_at: string; account_handle: string; platform: string },
>(posts: T[], perAccountCap: number | null, now: Date = new Date()): { kept: T[]; dropped: number } {
  const sorted = posts
    .filter((p) => isPostedOnIstDay(p.posted_at, now))
    .sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime());
  const counts = new Map<string, number>();
  const kept: T[] = [];
  for (const p of sorted) {
    const key = `${p.platform}:${p.account_handle.toLowerCase()}`;
    const n = counts.get(key) ?? 0;
    if (perAccountCap !== null && n >= perAccountCap) continue;
    counts.set(key, n + 1);
    kept.push(p);
  }
  return { kept, dropped: posts.length - kept.length };
}

/** True when `postedAt` falls on the same IST calendar day as `now`. Invalid dates return false. */
export function isPostedOnIstDay(postedAt: string | Date, now: Date = new Date()): boolean {
  const posted = postedAt instanceof Date ? postedAt : new Date(postedAt);
  if (isNaN(posted.getTime())) return false;
  const start = getIstDayStart(now).getTime();
  return posted.getTime() >= start && posted.getTime() < start + DAY_MS;
}
