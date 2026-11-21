import { createAdminClient } from "../supabase/admin.ts";
import type { ScraperRefreshStrategy } from "../../types/database.ts";

export const DEFAULT_REFRESH_STRATEGY: ScraperRefreshStrategy = {
  mode: "30_day_cutoff",
  refresh_interval_days: 7,
  cutoff_days: 30,
  discovery_post_limit: 10,
};

export interface SystemPlatformSettings {
  instagram: { enabled: boolean };
  facebook: { enabled: boolean };
  x: { enabled: boolean };
}

export const DEFAULT_PLATFORM_SETTINGS: SystemPlatformSettings = {
  instagram: { enabled: true },
  facebook: { enabled: false },
  x: { enabled: false },
};

/**
 * Loads the active multi-platform enablement settings from system_settings table.
 */
export async function getPlatformSettings(): Promise<SystemPlatformSettings> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "platform_enablement_settings")
      .maybeSingle();

    if (error || !data?.value) {
      return DEFAULT_PLATFORM_SETTINGS;
    }

    const val = data.value as Partial<SystemPlatformSettings>;
    return {
      instagram: { enabled: val.instagram?.enabled ?? true },
      facebook: { enabled: val.facebook?.enabled ?? false },
      x: { enabled: val.x?.enabled ?? false },
    };
  } catch (err: unknown) {
    console.warn("[settings] Could not query platform_enablement_settings, using defaults:", err);
    return DEFAULT_PLATFORM_SETTINGS;
  }
}

/**
 * Updates platform enablement settings in system_settings. Admin-only operation.
 */
export async function updatePlatformSettings(
  updates: Partial<SystemPlatformSettings>,
  userId?: string
): Promise<SystemPlatformSettings> {
  const current = await getPlatformSettings();
  const merged: SystemPlatformSettings = {
    instagram: { enabled: updates.instagram?.enabled ?? current.instagram.enabled },
    facebook: { enabled: updates.facebook?.enabled ?? current.facebook.enabled },
    x: { enabled: updates.x?.enabled ?? current.x.enabled },
  };

  const supabase = createAdminClient();
  const { error } = await supabase.from("system_settings").upsert(
    {
      key: "platform_enablement_settings",
      value: merged,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: "key" }
  );

  if (error) {
    throw new Error(`Failed to update platform settings: ${error.message}`);
  }

  return merged;
}

export interface FeatureSettings {
  /**
   * true  = original behaviour (only caption-matched posts are kept/refreshed).
   * false = capture & refresh every post; Campaign Captions UI is hidden.
   */
  campaign_captions_enabled: boolean;
}

export const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  campaign_captions_enabled: true,
};

/** Loads feature on/off flags from system_settings (defaults to everything on). */
export async function getFeatureSettings(): Promise<FeatureSettings> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "feature_settings")
      .maybeSingle();

    if (error || !data?.value) return DEFAULT_FEATURE_SETTINGS;

    const val = data.value as Partial<FeatureSettings>;
    return {
      campaign_captions_enabled: val.campaign_captions_enabled ?? true,
    };
  } catch (err: unknown) {
    console.warn("[settings] Could not query feature_settings, using defaults:", err);
    return DEFAULT_FEATURE_SETTINGS;
  }
}

/** Updates feature flags in system_settings. Admin-only operation. */
export async function updateFeatureSettings(
  updates: Partial<FeatureSettings>,
  userId?: string
): Promise<FeatureSettings> {
  const current = await getFeatureSettings();
  const merged: FeatureSettings = {
    campaign_captions_enabled:
      updates.campaign_captions_enabled ?? current.campaign_captions_enabled,
  };

  const supabase = createAdminClient();
  const { error } = await supabase.from("system_settings").upsert(
    {
      key: "feature_settings",
      value: merged,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: "key" }
  );

  if (error) {
    throw new Error(`Failed to update feature settings: ${error.message}`);
  }

  return merged;
}

/**
 * Loads the active scraper refresh strategy from the system_settings table.
 * Falls back to DEFAULT_REFRESH_STRATEGY (30-day cutoff, 7-day interval) if missing or on error.
 */
export async function getScraperRefreshStrategy(): Promise<ScraperRefreshStrategy> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "scraper_refresh_strategy")
      .maybeSingle();

    if (error || !data?.value) {
      return DEFAULT_REFRESH_STRATEGY;
    }

    const val = data.value as Partial<ScraperRefreshStrategy>;
    return {
      mode: val.mode === "continuous" ? "continuous" : "30_day_cutoff",
      refresh_interval_days:
        typeof val.refresh_interval_days === "number" && val.refresh_interval_days > 0
          ? val.refresh_interval_days
          : 7,
      cutoff_days:
        typeof val.cutoff_days === "number" && val.cutoff_days > 0
          ? val.cutoff_days
          : 30,
      discovery_post_limit:
        typeof val.discovery_post_limit === "number" && val.discovery_post_limit > 0
          ? val.discovery_post_limit
          : 10,
    };
  } catch (err: unknown) {
    console.warn("[settings] Could not query system_settings, using defaults:", err);
    return DEFAULT_REFRESH_STRATEGY;
  }
}

/**
 * Updates the scraper refresh strategy in system_settings.
 * Admin-only operation.
 */
export async function updateScraperRefreshStrategy(
  updates: Partial<ScraperRefreshStrategy>,
  userId?: string
): Promise<ScraperRefreshStrategy> {
  const current = await getScraperRefreshStrategy();
  const merged: ScraperRefreshStrategy = {
    mode: updates.mode ?? current.mode,
    refresh_interval_days: updates.refresh_interval_days ?? current.refresh_interval_days,
    cutoff_days: updates.cutoff_days ?? current.cutoff_days,
    discovery_post_limit: updates.discovery_post_limit ?? current.discovery_post_limit,
  };

  const supabase = createAdminClient();
  const { error } = await supabase.from("system_settings").upsert(
    {
      key: "scraper_refresh_strategy",
      value: merged,
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: "key" }
  );

  if (error) {
    throw new Error(`Failed to update scraper refresh strategy: ${error.message}`);
  }

  return merged;
}
