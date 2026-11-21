import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerComponentClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  try {
    const supabaseUser = createServerComponentClient();
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const msg = err instanceof Error ? err.message : "Failed to load settings";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/admin/settings
 * Updates scraper refresh strategy and/or platform toggles. Restricted to Admins.
 */
export async function POST(request: NextRequest) {
  try {
    const supabaseUser = createServerComponentClient();
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify Admin role
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden: Only administrators can update platform settings." },
        { status: 403 }
      );
    }

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
    const msg = err instanceof Error ? err.message : "Failed to update settings";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
