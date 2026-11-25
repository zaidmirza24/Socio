/**
 * Post URLs sent to the provider per engagement-refresh run. Dependency-free so tests can import it.
 * Larger batches mean fewer Apify runs (each run reserves memory from the account-wide limit).
 */
export const DIRECT_URL_BATCH_SIZE = 100;

/**
 * Most refresh runs kept in flight at once across all platforms. Apify's memory limit is
 * account-wide (16 GB on the free plan), so the remaining batches wait in a queue instead of all
 * starting together and being rejected.
 */
export const MAX_CONCURRENT_REFRESH_RUNS = 3;

/**
 * Memory (MB) requested for each Apify run, per platform. Without this each run takes the actor's
 * default (4 GB for the Instagram actor), which exhausts the account-wide limit with a few runs.
 * Must be a power of two, 128 or more. If a run fails with an out-of-memory / "memory must be at
 * least" error, raise that platform's value.
 */
/** Hard time limit for a started run (seconds). Apify aborts the run when it is reached. */
export const APIFY_RUN_TIMEOUT_SECS = 2 * 60 * 60;

/** Single-post lookups are awaited inside a request, so they get a much shorter limit. */
export const APIFY_DIRECT_POST_TIMEOUT_SECS = 5 * 60;

/** Dataset items fetched per request when reading a finished run. */
export const APIFY_DATASET_PAGE_SIZE = 1000;

/** Apify publishes final cost/stats a little after a run ends; earlier numbers can be preliminary. */
export const APIFY_USAGE_SETTLE_MS = 30_000;

export const APIFY_RUN_MEMORY_MB = {
  instagram: 1024,
  facebook: 512,
  x: 512,
} as const;
