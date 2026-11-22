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
import { MAX_CONCURRENT_REFRESH_RUNS } from "@/lib/config/batching";
import { getPlatformSettings } from "@/lib/services/settings";
import type { PlatformType } from "@/types/database";

const payloadSchema = z.object({
  jobType: z.enum(["discovery", "refresh"]).default("discovery"),
  postLimit: z.number().int().min(1).max(50).optional(),
  /** Refresh only: include posts that are not yet due for their interval refresh. */
  force: z.boolean().optional(),
  /** Limit the run to one platform. Omit to run every enabled platform. */
  platform: z.enum(["instagram", "facebook", "x"]).optional(),
});

interface PlatformRunResult {
  platform: PlatformType;
  ok: boolean;
  runIds: string[];
  /** Refresh batches (post URLs) waiting for a free slot / free Apify memory. */
  queuedBatches: string[][];
  accountsCount?: number;
  message: string;
}

/**
 * POST /api/scraper/trigger-all
 *
 * Admin-only. Starts one run per enabled platform (Instagram always; Facebook/X when enabled
 * in Settings). A failure on one platform (e.g. no active accounts) does not stop the others.
 * The client polls /api/scraper/status for every returned runId, which also ingests the data.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid trigger request payload", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const { jobType, postLimit, force, platform: onlyPlatform } = parsed.data;

  let platformSettings: Awaited<ReturnType<typeof getPlatformSettings>>;
  try {
    platformSettings = await getPlatformSettings();
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read platform settings" },
      { status: 500 }
    );
  }
  const platforms: PlatformType[] = ["instagram"];
  if (platformSettings.facebook?.enabled) platforms.push("facebook");
  if (platformSettings.x?.enabled) platforms.push("x");
  if (onlyPlatform) {
    // Only honour an explicit platform when it is enabled in Settings.
    const allowed = platforms.filter((p) => p === onlyPlatform);
    platforms.length = 0;
    platforms.push(...allowed);
    if (platforms.length === 0) {
      return NextResponse.json(
        { error: `${onlyPlatform} is turned off. Enable it in Settings first.` },
        { status: 400 }
      );
    }
  }

  const results: PlatformRunResult[] = [];
  // Apify's memory limit is account-wide, so refresh batches share one concurrency budget across
  // platforms; whatever does not fit is returned as `queuedBatches` for the client to start later.
  let refreshSlots = MAX_CONCURRENT_REFRESH_RUNS;
  for (const platform of platforms) {
    try {
      if (jobType === "refresh") {
        const res = await triggerWeeklyRefresh({ platform, force, maxStart: refreshSlots });
        refreshSlots = Math.max(0, refreshSlots - res.jobIds.length);
        results.push({
          platform,
          ok: res.success, // success with no runIds and no queue = nothing was due
          runIds: res.jobIds,
          queuedBatches: res.queuedBatches,
          message: res.message,
        });
      } else {
        const res = await triggerDailyDiscovery({ platform, postLimit });
        results.push({
          platform,
          ok: true,
          runIds: [res.jobId],
          queuedBatches: [],
          accountsCount: res.accountsCount,
          message: `Started for ${res.accountsCount} active ${platform} account(s).`,
        });
      }
    } catch (err: unknown) {
      if (err instanceof RunAlreadyActiveError) {
        // Resume polling the run that is already going instead of paying for a duplicate.
        refreshSlots = Math.max(0, refreshSlots - err.runIds.length);
        results.push({ platform, ok: true, runIds: err.runIds, queuedBatches: [], message: err.message });
        continue;
      }
      results.push({
        platform,
        ok: false,
        runIds: [],
        queuedBatches: [],
        message: isMemoryLimitError(err)
          ? MEMORY_FULL_MESSAGE
          : err instanceof Error
            ? err.message
            : "Failed to start run",
      });
    }
  }

  const started = results.filter((r) => r.ok).length;
  return NextResponse.json(
    {
      success: started > 0,
      jobType,
      results,
      message: `Started ${started} of ${platforms.length} platform run(s).`,
    },
    { status: started > 0 ? 200 : 500 }
  );
}
