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
