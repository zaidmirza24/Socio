const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Supabase returns at most 1000 rows per request. This walks every page so callers get the
 * complete result (e.g. 1800 accounts). `build(from, to)` must return the query for that row range
 * with a stable ORDER BY, otherwise pages can overlap or skip rows.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

/** Splits a list into chunks (used to keep `.in(...)` filters under URL length limits). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
