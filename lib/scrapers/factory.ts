import { getServerEnv } from "../env.ts";
import { ApifyScraperProvider } from "./apify/provider.ts";
import type { IScraperProvider, ScraperProviderType } from "./types.ts";

let cachedApifyProvider: ApifyScraperProvider | null = null;

/**
 * Factory function to retrieve the active scraper provider.
 * Allows switching providers centrally via ACTIVE_SCRAPER_PROVIDER in .env.local
 * or via runtime override for test executions.
 */
export function getScraperProvider(
  providerOverride?: ScraperProviderType
): IScraperProvider {
  let selectedProvider: ScraperProviderType = "apify";

  if (providerOverride) {
    selectedProvider = providerOverride;
  } else {
    try {
      const env = getServerEnv();
      selectedProvider = (env.ACTIVE_SCRAPER_PROVIDER as ScraperProviderType) || "apify";
    } catch {
      selectedProvider = "apify";
    }
  }

  switch (selectedProvider) {
    case "apify":
      if (!cachedApifyProvider) {
        cachedApifyProvider = new ApifyScraperProvider();
      }
      return cachedApifyProvider;

    case "brightdata":
      throw new Error(
        "Bright Data provider is currently on hold / skipped as requested. " +
        "Please use ACTIVE_SCRAPER_PROVIDER=apify in .env.local."
      );

    default:
      throw new Error(`Unsupported scraper provider: ${selectedProvider}`);
  }
}
