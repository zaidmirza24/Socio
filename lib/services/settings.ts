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
 * Reads one system_settings value. Returns null only when the row does not exist (then callers
 * use their defaults). A database error THROWS: silently falling back to defaults would e.g. turn
 * Facebook/X off for a run, or let an update overwrite the real settings with defaults.
 */
async function readSetting(key: string): Promise<unknown | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("system_settings").select("value").eq("key", key).maybeSingle();
  if (error) {
    throw new Error(`Could not read setting '${key}': ${error.message}`);
  }
  return data?.value ?? null;
}

/**
 * Loads the active multi-platform enablement settings from system_settings table.
 */
export async function getPlatformSettings(): Promise<SystemPlatformSettings> {
  const raw = await readSetting("platform_enablement_settings");
  if (!raw) return DEFAULT_PLATFORM_SETTINGS;
  const val = raw as Partial<SystemPlatformSettings>;
  return {
    instagram: { enabled: val.instagram?.enabled ?? true },
    facebook: { enabled: val.facebook?.enabled ?? false },
    x: { enabled: val.x?.enabled ?? false },
  };
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
  const raw = await readSetting("feature_settings");
  if (!raw) return DEFAULT_FEATURE_SETTINGS;
  const val = raw as Partial<FeatureSettings>;
  return {
    campaign_captions_enabled:
      typeof val.campaign_captions_enabled === "boolean"
        ? val.campaign_captions_enabled
        : DEFAULT_FEATURE_SETTINGS.campaign_captions_enabled,
  };
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
 * Falls back to DEFAULT_REFRESH_STRATEGY (30-day cutoff, 7-day interval) when not saved yet.
 * Throws on a database error.
 */
export async function getScraperRefreshStrategy(): Promise<ScraperRefreshStrategy> {
  const raw = await readSetting("scraper_refresh_strategy");
  if (!raw) return DEFAULT_REFRESH_STRATEGY;
  {
    const val = raw as Partial<ScraperRefreshStrategy>;
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
