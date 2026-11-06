import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format date to standard YYYY-MM-DD
 */
export function formatDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0];
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

export function getDateFilterSince(preset: DateRangePreset = "30d"): string | null {
  if (preset === "all") return null;
  const now = new Date();
  if (preset === "today") {
    return now.toISOString().slice(0, 10);
  }
  const days = preset === "7d" ? 7 : preset === "180d" ? 180 : 30;
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
