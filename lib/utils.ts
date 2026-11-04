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
 * Format metrics for dashboard display.
 * Returns "n/a" when metric is null (unmeasured/hidden), or localized number if 0 or positive.
 */
export function formatMetric(val: number | null | undefined): string {
  if (val === null || val === undefined) {
    return "n/a";
  }
  return new Intl.NumberFormat().format(val);
}
