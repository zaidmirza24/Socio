import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { triggerDailyDiscovery, triggerWeeklyRefresh } from "@/lib/services/scraper-orchestrator";
import { getPlatformSettings } from "@/lib/services/settings";
import type { PlatformType } from "@/types/database";

const payloadSchema = z.object({
  jobType: z.enum(["discovery", "refresh"]).default("discovery"),
  postLimit: z.number().int().min(1).max(50).optional(),
  /** Limit the run to one platform. Omit to run every enabled platform. */
  platform: z.enum(["instagram", "facebook", "x"]).optional(),
});

interface PlatformRunResult {
  platform: PlatformType;
  ok: boolean;
  runIds: string[];
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
  const { jobType, postLimit, platform: onlyPlatform } = parsed.data;

  const platformSettings = await getPlatformSettings();
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
  for (const platform of platforms) {
    try {
      if (jobType === "refresh") {
        const res = await triggerWeeklyRefresh({ platform });
        results.push({
          platform,
          ok: res.success, // success with no runIds = nothing was due
          runIds: res.jobIds,
          message: res.message,
        });
      } else {
        const res = await triggerDailyDiscovery({ platform, postLimit });
        results.push({
          platform,
          ok: true,
          runIds: [res.jobId],
          accountsCount: res.accountsCount,
          message: `Started for ${res.accountsCount} active ${platform} account(s).`,
        });
      }
    } catch (err: unknown) {
      results.push({
        platform,
        ok: false,
        runIds: [],
        message: err instanceof Error ? err.message : "Failed to start run",
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
