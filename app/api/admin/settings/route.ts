import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalError } from "@/lib/api/errors";
import { requireAdmin, requireUser } from "@/lib/supabase/require-admin";
import {
  getScraperRefreshStrategy,
  updateScraperRefreshStrategy,
  getPlatformSettings,
  updatePlatformSettings,
  getFeatureSettings,
  updateFeatureSettings,
} from "@/lib/services/settings";
import { getScraperRefreshEligibilityStats } from "@/lib/services/scraper-orchestrator";
import { matchStoredPosts, type MatchStoredPostsSummary } from "@/lib/services/match-stored-posts";

const updateStrategySchema = z.object({
  mode: z.enum(["30_day_cutoff", "continuous"]).optional(),
  refresh_interval_days: z.number().int().min(1).max(90).optional(),
  cutoff_days: z.number().int().min(1).max(365).optional(),
  discovery_post_limit: z.number().int().min(1).max(50).optional(),
  max_run_cost_usd: z.number().min(0.5).max(1000).nullable().optional(),
  platforms: z
    .object({
      instagram: z.object({ enabled: z.boolean() }).optional(),
      facebook: z.object({ enabled: z.boolean() }).optional(),
      x: z.object({ enabled: z.boolean() }).optional(),
    })
    .optional(),
  features: z
    .object({
      campaign_captions_enabled: z.boolean().optional(),
    })
    .optional(),
});

/**
 * GET /api/admin/settings
 * Returns the current scraper strategy, platform enablement, and post refresh eligibility counts.
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const strategy = await getScraperRefreshStrategy();
    const platformSettings = await getPlatformSettings();
    const featureSettings = await getFeatureSettings();
    const stats = await getScraperRefreshEligibilityStats();

    return NextResponse.json({
      strategy,
      platformSettings,
      featureSettings,
      stats,
    });
  } catch (err: unknown) {
    return internalError(err, "Failed to load settings");
  }
}

/**
 * POST /api/admin/settings
 * Updates scraper refresh strategy and/or platform toggles. Restricted to Admins.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const user = { id: guard.userId };

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = updateStrategySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid settings format", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { platforms, features, ...strategyUpdates } = parsed.data;

    let updatedStrategy;
    if (Object.keys(strategyUpdates).length > 0) {
      updatedStrategy = await updateScraperRefreshStrategy(strategyUpdates, user.id);
    } else {
      updatedStrategy = await getScraperRefreshStrategy();
    }

    let updatedPlatforms;
    if (platforms) {
      updatedPlatforms = await updatePlatformSettings(platforms, user.id);
    } else {
      updatedPlatforms = await getPlatformSettings();
    }

    const updatedFeatures = features
      ? await updateFeatureSettings(features, user.id)
      : await getFeatureSettings();

    // Turning the caption filter ON: label every stored post against the captions right away.
    // Posts are never hidden or deleted; they just get matched / needs review / not matched.
    let matching: MatchStoredPostsSummary | null = null;
    if (features?.campaign_captions_enabled === true) {
      try {
        matching = await matchStoredPosts();
      } catch (matchErr: unknown) {
        matching = {
          checked: 0,
          matched: 0,
          needsReview: 0,
          unmatched: 0,
          rejected: 0,
          errors: [matchErr instanceof Error ? matchErr.message : "Matching failed"],
        };
      }
    }

    const stats = await getScraperRefreshEligibilityStats();

    return NextResponse.json({
      success: true,
      strategy: updatedStrategy,
      platformSettings: updatedPlatforms,
      featureSettings: updatedFeatures,
      stats,
      matching,
      message: "Settings updated successfully.",
    });
  } catch (err: unknown) {
    return internalError(err, "Failed to update settings");
  }
}
