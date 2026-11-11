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

/**
 * Format a date string or Date object for UI display using a fixed locale ("en-US")
 * to guarantee identical server and client rendering and prevent Next.js hydration mismatches.
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
    ...options,
  }).format(d);
}

/**
 * Format a date & time for UI display using a fixed locale ("en-US") to prevent
 * Next.js hydration mismatches.
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
  const days = preset === "7d" ? 7 : preset === "180d" ? 180 : 30;
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return formatDate(d, timeZone);
}
