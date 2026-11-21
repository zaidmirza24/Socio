/**
 * Metric integrity helpers (AGENTS.md: null = not measured, 0 = measured zero; never mix them).
 */

/** Growth since the previous value; null when either side was not measured. Never negative. */
export function growthOrNull(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  return Math.max(0, current - previous);
}

/**
 * Drops null/undefined metrics from an upsert payload. PostgREST only writes the columns present,
 * so on conflict an unmeasured value never overwrites a value measured earlier the same day,
 * while a brand-new row still gets NULL for the missing columns.
 */
export function measuredOnly<T extends Record<string, number | null | undefined>>(metrics: T): Partial<Record<keyof T, number>> {
  const out: Partial<Record<keyof T, number>> = {};
  for (const key of Object.keys(metrics) as (keyof T)[]) {
    const value = metrics[key];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

/** Sums measured values; null when nothing was measured (so the UI shows "n/a", not 0). */
export function sumMeasured(values: Iterable<number | null | undefined>): number | null {
  let total: number | null = null;
  for (const v of values) {
    if (typeof v === "number") total = (total ?? 0) + v;
  }
  return total;
}
