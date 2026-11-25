/**
 * Pure planning for Apify Schedules: turns "these dates, at this time (IST), on these platforms" into
 * the cron expressions to create. No I/O, so it is unit-tested directly.
 *
 * Apify cron has no year and no end date, so a date window is expressed as one cron per calendar
 * month segment ("0 9 24-30 11 *"). Platforms are staggered a few minutes apart so their runs do
 * not all claim Apify's account-wide memory at the same moment.
 */
import { getIstDayStart } from "../utils/day-window.ts";
import type { PlatformType } from "../../types/database.ts";

export const SCHEDULE_TIMEZONE = "Asia/Kolkata";
/** Default minutes between one platform's run and the next platform's run on the same day. */
export const DEFAULT_GAP_MINUTES = 10;
/** Largest gap an admin can set between platforms. */
export const MAX_GAP_MINUTES = 120;
/** Longest date window, so a window never needs an unreasonable number of Apify schedules. */
export const MAX_RANGE_DAYS = 240;
/** Cron has no year, so the first run must be within a year or it would fire on the wrong date. */
export const MAX_DAYS_AHEAD = 330;
/** Canonical platform order: runs are staggered in this order. */
export const SCHEDULE_PLATFORMS: PlatformType[] = ["instagram", "facebook", "x"];
/** A run that Apify started within this many minutes after a planned time is attributed to it. */
export const FIRE_GRACE_MINUTES = 45;

export type ScheduleMode = "once" | "range";

export interface ScheduleWindow {
  mode: ScheduleMode;
  /** IST calendar date, YYYY-MM-DD. */
  startDate: string;
  /** IST calendar date; equal to startDate for "once". */
  endDate: string;
}

export interface ScheduleRequest extends ScheduleWindow {
  /** HH:MM, IST, 24h. The first platform runs at this time. */
  runTime: string;
  platforms: PlatformType[];
  /** Minutes between platforms (0 = all at the same time). Defaults to DEFAULT_GAP_MINUTES. */
  gapMinutes?: number;
}

export interface PlannedEntry {
  platform: PlatformType;
  /** Five-field cron, evaluated in Asia/Kolkata. */
  cron: string;
  /** HH:MM (IST) this platform fires at. */
  fireTime: string;
  /** First and last IST date this cron is meant to fire on. */
  segmentStart: string;
  segmentEnd: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses YYYY-MM-DD as a UTC date at midnight; null when it is not a real calendar date. */
export function parseDate(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

export function parseTime(value: string): number | null {
  const m = TIME_RE.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Today's calendar date in IST (YYYY-MM-DD). */
export function istToday(now: Date = new Date()): string {
  return new Date(getIstDayStart(now).getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Minutes since IST midnight for an instant. */
function istMinuteOfDay(at: Date): number {
  const istMs = at.getTime() + 5.5 * 60 * 60 * 1000;
  return Math.floor((((istMs % DAY_MS) + DAY_MS) % DAY_MS) / 60000);
}

function istDateOf(at: Date): string {
  return new Date(at.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The platforms in canonical order, de-duplicated. */
export function orderPlatforms(platforms: PlatformType[]): PlatformType[] {
  return SCHEDULE_PLATFORMS.filter((p) => platforms.includes(p));
}

/** Returns an error message a person can act on, or null when the request is valid. */
export function validateScheduleRequest(req: ScheduleRequest, now: Date = new Date()): string | null {
  const start = parseDate(req.startDate);
  const end = parseDate(req.endDate);
  const minutes = parseTime(req.runTime);
  if (!start) return "Start date is not a valid date.";
  if (!end) return "End date is not a valid date.";
  if (minutes === null) return "Time must look like 09:30 (24-hour, IST).";
  if (req.platforms.length === 0) return "Pick at least one platform.";
  if (req.mode === "once" && req.startDate !== req.endDate) return "A single-date schedule has one date.";
  if (end.getTime() < start.getTime()) return "End date is before the start date.";

  const spanDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (spanDays > MAX_RANGE_DAYS) return `A schedule can cover at most ${MAX_RANGE_DAYS} days. Split it into two.`;

  const gap = req.gapMinutes ?? DEFAULT_GAP_MINUTES;
  if (!Number.isInteger(gap) || gap < 0 || gap > MAX_GAP_MINUTES) {
    return `The gap between platforms must be a whole number from 0 to ${MAX_GAP_MINUTES} minutes.`;
  }
  const platformCount = orderPlatforms(req.platforms).length;
  const lastMinutes = minutes + (platformCount - 1) * gap;
  if (lastMinutes > 23 * 60 + 59) {
    return `With ${platformCount} platforms ${gap} minutes apart, the last one would pass midnight. Pick an earlier time or a smaller gap.`;
  }

  const today = istToday(now);
  const todayDate = parseDate(today);
  if (!todayDate) return "Could not work out today's date.";
  if (req.startDate < today) return "The start date is in the past.";
  if ((start.getTime() - todayDate.getTime()) / DAY_MS > MAX_DAYS_AHEAD) {
    return `The start date must be within ${MAX_DAYS_AHEAD} days from today.`;
  }
  if (req.startDate === today && minutes <= istMinuteOfDay(now)) {
    return "That time has already passed today. Pick a later time, or start tomorrow.";
  }
  return null;
}

/** Splits an inclusive date window into per-calendar-month segments. */
export function monthSegments(startDate: string, endDate: string): { start: string; end: string }[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const segments: { start: string; end: string }[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const segEnd = monthEnd.getTime() < end.getTime() ? monthEnd : end;
    segments.push({ start: cursor.toISOString().slice(0, 10), end: segEnd.toISOString().slice(0, 10) });
    cursor = new Date(segEnd.getTime() + DAY_MS);
  }
  return segments;
}

/** Cron for one platform and one month segment. */
export function cronFor(minuteOfDay: number, segStart: string, segEnd: string): string {
  const s = parseDate(segStart);
  const e = parseDate(segEnd);
  if (!s || !e) throw new Error("Invalid date segment");
  const dayFrom = s.getUTCDate();
  const dayTo = e.getUTCDate();
  const days = dayFrom === dayTo ? String(dayFrom) : `${dayFrom}-${dayTo}`;
  return `${minuteOfDay % 60} ${Math.floor(minuteOfDay / 60)} ${days} ${s.getUTCMonth() + 1} *`;
}

/** Every Apify schedule needed for this request. Throws if the request is invalid. */
export function planSchedule(req: ScheduleRequest, now: Date = new Date()): PlannedEntry[] {
  const problem = validateScheduleRequest(req, now);
  if (problem) throw new Error(problem);
  const base = parseTime(req.runTime) as number;
  const segments = monthSegments(req.startDate, req.endDate);
  const entries: PlannedEntry[] = [];
  orderPlatforms(req.platforms).forEach((platform, index) => {
    const minuteOfDay = base + index * (req.gapMinutes ?? DEFAULT_GAP_MINUTES);
    for (const seg of segments) {
      entries.push({
        platform,
        cron: cronFor(minuteOfDay, seg.start, seg.end),
        fireTime: formatMinutes(minuteOfDay),
        segmentStart: seg.start,
        segmentEnd: seg.end,
      });
    }
  });
  return entries;
}

/**
 * True when an Apify run that started at `startedAt` is the one this planned entry produced:
 * on one of its dates, and within a short grace period after its time. Used to tell our scheduled
 * runs apart from any other schedule the same Apify account may have.
 */
export function runMatchesEntry(
  startedAt: Date,
  entry: Pick<PlannedEntry, "fireTime" | "segmentStart" | "segmentEnd">
): boolean {
  if (Number.isNaN(startedAt.getTime())) return false;
  const fire = parseTime(entry.fireTime);
  if (fire === null) return false;
  const date = istDateOf(startedAt);
  if (date < entry.segmentStart || date > entry.segmentEnd) return false;
  const delta = istMinuteOfDay(startedAt) - fire;
  return delta >= 0 && delta <= FIRE_GRACE_MINUTES;
}

/** Stable hash input for "did the handle list change since the schedule input was saved". */
export function handleSignature(handles: string[]): string {
  const sorted = [...new Set(handles)].sort();
  let h = 5381;
  for (const handle of sorted) {
    for (let i = 0; i < handle.length; i++) h = ((h << 5) + h + handle.charCodeAt(i)) | 0;
    h = ((h << 5) + h + 44) | 0; // separator, so ["ab","c"] differs from ["a","bc"]
  }
  return `${sorted.length}:${(h >>> 0).toString(36)}`;
}

/** The status a schedule should have given today's date and its entries. */
export function isFinished(endDate: string, now: Date = new Date()): boolean {
  return endDate < istToday(now);
}
