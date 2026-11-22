import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import {
  MEMORY_FULL_MESSAGE,
  RunAlreadyActiveError,
  getRefreshGroupProgress,
  isMemoryLimitError,
  triggerDailyDiscovery,
  triggerWeeklyRefresh,
} from "@/lib/services/scraper-orchestrator";
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
  /** Refresh only: the queued job to follow. Batches may still be waiting to start. */
  batchGroup: string | null;
  /** Refresh batches waiting for a free slot / free Apify memory. */
  queuedCount: number;
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
  // Refresh batches go into a database queue shared by all platforms; the queue starts only as many
  // as Apify's account-wide memory limit allows and the rest start as running ones finish.
  for (const platform of platforms) {
    try {
      if (jobType === "refresh") {
        const res = await triggerWeeklyRefresh({ platform, force });
        results.push({
          platform,
          ok: res.success, // success with no runIds and no queue = nothing was due
          runIds: res.jobIds,
          batchGroup: res.batchGroup,
          queuedCount: res.queuedCount,
          message: res.message,
        });
      } else {
        const res = await triggerDailyDiscovery({ platform, postLimit });
        results.push({
          platform,
          ok: true,
          runIds: [res.jobId],
          batchGroup: null,
          queuedCount: 0,
          accountsCount: res.accountsCount,
          message: `Started for ${res.accountsCount} active ${platform} account(s).`,
        });
      }
    } catch (err: unknown) {
      if (err instanceof RunAlreadyActiveError) {
        // Resume polling the run that is already going instead of paying for a duplicate.
        // A queued refresh may still have batches waiting; report them so the panel keeps following.
        const queued = err.batchGroup ? await getRefreshGroupProgress(err.batchGroup) : null;
        results.push({
          platform,
          ok: true,
          runIds: [...new Set([...err.runIds, ...(queued?.runIds ?? [])])],
          batchGroup: err.batchGroup,
          queuedCount: queued ? queued.queued + queued.starting : 0,
          message: err.message,
        });
        continue;
      }
      results.push({
        platform,
        ok: false,
        runIds: [],
        batchGroup: null,
        queuedCount: 0,
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
