import { NextRequest } from "next/server";
import { GET as getScraperStatus } from "@/app/api/scraper/status/route";

/**
 * Backward compatibility proxy for /api/apify/status
 * Delegates to the unified provider-independent scraper status endpoint.
 */
export async function GET(request: NextRequest) {
  return getScraperStatus(request);
}
