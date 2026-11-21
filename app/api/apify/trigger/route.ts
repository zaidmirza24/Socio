import { NextRequest } from "next/server";
import { POST as triggerScraper } from "@/app/api/scraper/trigger/route";

/**
 * Backward compatibility proxy for /api/apify/trigger
 * Delegates to the unified provider-independent scraper trigger endpoint.
 */
export async function POST(request: NextRequest) {
  return triggerScraper(request);
}
