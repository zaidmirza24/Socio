import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format date to standard YYYY-MM-DD in the operational timezone (Asia/Kolkata by default)
 */
export function formatDate(date: Date = new Date(), timeZone: string = "Asia/Kolkata"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().split("T")[0];
  }
}

/** The campaign's operational timezone. All user-facing dates and "days" are IST. */
export const APP_TIME_ZONE = "Asia/Kolkata";

/**
 * "YYYY-MM-DD HH:mm" in IST for an ISO timestamp (e.g. a post's posted_at).
 * Returns "" for empty/invalid input. Server and client render the same string.
 */
export function formatIstDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * Short label ("Nov 21") for a calendar day given as "YYYY-MM-DD". The string is already a day,
 * so it is formatted in UTC to stop the viewer's/host's timezone shifting it to the previous day.
 */
export function formatDayLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * Format a date string or Date object for UI display using a fixed locale ("en-US") and the IST
 * timezone, so server (UTC on Vercel) and client render the same day and no hydration mismatch.
 * Example output: "Nov 10, 2026"
 */
export function formatDisplayDate(
  dateInput: string | Date | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!dateInput) return "n/a";
  const d = typeof dateInput === "string" || typeof dateInput === "number" ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return "n/a";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
    ...options,
  }).format(d);
}

/**
 * Format a date & time for UI display using a fixed locale ("en-US") and IST, to prevent
 * Next.js hydration mismatches and UTC-host day shifts.
 * Example output: "Nov 10, 2026, 8:15 PM"
 */
export function formatDisplayDateTime(
  dateInput: string | Date | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!dateInput) return "n/a";
  const d = typeof dateInput === "string" || typeof dateInput === "number" ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return "n/a";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
    ...options,
  }).format(d);
}

/**
 * Format a number with comma separators using a fixed locale so that server
 * and client render identical strings (avoids Next.js hydration mismatches).
 */
export function formatNumber(val: number): string {
  return new Intl.NumberFormat("en-US").format(val);
}

/**
 * Format metrics for dashboard display.
 * Returns "n/a" when metric is null (unmeasured/hidden), or localized number if 0 or positive.
 * Uses a fixed locale to prevent SSR/client hydration mismatches.
 */
export function formatMetric(val: number | null | undefined): string {
  if (val === null || val === undefined) {
    return "n/a";
  }
  return formatNumber(val);
}

export type DateRangePreset = "today" | "7d" | "30d" | "180d" | "all";

export function getDateFilterSince(
  preset: DateRangePreset = "today",
  timeZone: string = "Asia/Kolkata"
): string | null {
  if (preset === "all") return null;
  const now = new Date();
  if (preset === "today") {
    return formatDate(now, timeZone);
  }
  // "7d" = today plus the 6 days before it (7 calendar days), not 8.
  const days = preset === "7d" ? 7 : preset === "180d" ? 180 : 30;
  const d = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return formatDate(d, timeZone);
}
