import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  MEMORY_FULL_MESSAGE,
  RunAlreadyActiveError,
  isMemoryLimitError,
  triggerDailyDiscovery,
  triggerWeeklyRefresh,
} from "@/lib/services/scraper-orchestrator";
import { getPlatformSettings } from "@/lib/services/settings";
import type { ScraperProviderType } from "@/lib/scrapers/types";
import type { PlatformType } from "@/types/database";

const triggerPayloadSchema = z.object({
  jobType: z.enum(["discovery", "refresh"]).default("discovery"),
  platform: z.enum(["instagram", "facebook", "x"]).default("instagram"),
  postLimit: z.number().int().min(1).max(50).optional(),
  // Bounded so a single request cannot start an arbitrarily large (expensive) run.
  handles: z.array(z.string().trim().min(1).max(100)).max(1000).optional(),
  urls: z.array(z.string().url().max(500)).max(2000).optional(),
  force: z.boolean().optional(),
  provider: z.enum(["apify"]).optional(),
});

/**
 * POST /api/scraper/trigger
 *
 * Provider-independent scraping trigger endpoint.
 * Dispatches either:
 * - PART A: Daily new-post discovery across monitored accounts
 * - PART B: Seven-day existing-post engagement refresh queue
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    // Scraper runs spend paid Apify credit, so only admins may start them.
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    // 2. Parse request body
    const body = await request.json().catch(() => ({}));
    const parsed = triggerPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid trigger request payload", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { jobType, platform, postLimit, handles, urls, force, provider } = parsed.data;

    // Check platform toggle saved in Settings (system_settings table), not a hardcoded flag
    const platformSettings = await getPlatformSettings();
    if (platform !== "instagram" && !platformSettings[platform].enabled) {
      return NextResponse.json(
        {
          error: `Platform '${platform}' is currently disabled in system settings. Enable it in Settings before triggering runs.`,
          platform,
        },
        { status: 400 }
      );
    }

    // 3. Dispatch based on jobType
    if (jobType === "refresh") {
      const refreshResult = await triggerWeeklyRefresh({
        platform: platform as PlatformType,
        customUrls: urls,
        force,
        providerOverride: provider as ScraperProviderType,
      });

      return NextResponse.json({
        success: refreshResult.success,
        jobType: "refresh",
        platform,
        jobIds: refreshResult.jobIds,
        batchGroup: refreshResult.batchGroup,
        queuedCount: refreshResult.queuedCount,
        runId: refreshResult.jobIds[0] || null, // For single-batch polling
        eligiblePostsCount: refreshResult.eligiblePostsCount,
        dispatchedBatchesCount: refreshResult.dispatchedBatchesCount,
        message: refreshResult.message,
      });
    }

    // PART A: Daily discovery
    const discoveryResult = await triggerDailyDiscovery(
      {
        platform: platform as PlatformType,
        postLimit,
        customHandles: handles,
      },
      provider as ScraperProviderType
    );

    return NextResponse.json({
      success: true,
      jobType: "discovery",
      platform,
      provider: discoveryResult.provider,
      runId: discoveryResult.jobId,
      jobId: discoveryResult.jobId,
      defaultDatasetId: discoveryResult.datasetOrSnapshotId,
      status: discoveryResult.status,
      accountsCount: discoveryResult.accountsCount,
      targetHandles: discoveryResult.targets,
      executionMode: discoveryResult.executionMode,
      message: `Discovery run dispatched for ${discoveryResult.accountsCount} active ${platform} account(s) via ${discoveryResult.provider}.`,
    });
  } catch (err: unknown) {
    if (err instanceof RunAlreadyActiveError) {
      return NextResponse.json(
        { error: err.message, errorType: "RUN_ACTIVE", runIds: err.runIds, runId: err.runIds[0] ?? null },
        { status: 409 }
      );
    }
    if (isMemoryLimitError(err)) {
      return NextResponse.json({ error: MEMORY_FULL_MESSAGE, errorType: "MEMORY_FULL" }, { status: 429 });
    }
    const errorMsg = err instanceof Error ? err.message : "Failed to trigger scraper run";
    return NextResponse.json(
      {
        error: errorMsg,
        errorType: "SCRAPER",
      },
      { status: 500 }
    );
  }
}
