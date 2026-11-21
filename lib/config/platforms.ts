import type { PlatformType } from "../../types/database.ts";

export interface PlatformConfigItem {
  name: string;
  enabled: boolean;
  discoveryEnabled: boolean;
  refreshEnabled: boolean;
  discoveryActorId: string;
  refreshActorId: string;
  resultsLimit: number;
  batchSize: number;
}

export const PLATFORM_CONFIG: Record<PlatformType, PlatformConfigItem> = {
  instagram: {
    name: "Instagram",
    enabled: true,
    discoveryEnabled: true,
    refreshEnabled: true,
    discoveryActorId: process.env.APIFY_INSTAGRAM_ACTOR_ID || "nH2AHrwxeTRJoN5hX",
    // Instagram Part B uses the same actor with direct post URLs passed in username[]
    refreshActorId: process.env.APIFY_INSTAGRAM_ACTOR_ID || "nH2AHrwxeTRJoN5hX",
    resultsLimit: 10,
    batchSize: 30,
  },
  facebook: {
    name: "Facebook",
    enabled: false,
    discoveryEnabled: false,
    refreshEnabled: false,
    discoveryActorId: process.env.APIFY_FACEBOOK_ACTOR_ID || "AtBpiepuIUNs2k2ku",
    refreshActorId: process.env.APIFY_FACEBOOK_POST_ACTOR_ID || "CaeV1AcRJULMI4vJ3",
    resultsLimit: 10,
    batchSize: 30,
  },
  x: {
    name: "Twitter / X",
    enabled: false,
    discoveryEnabled: false,
    refreshEnabled: false,
    discoveryActorId: process.env.APIFY_TWITTER_ACTOR_ID || "Fo9GoU5wC270BgcBr",
    refreshActorId: process.env.APIFY_TWITTER_POST_ACTOR_ID || "73fHdfmMLDzePgHob",
    resultsLimit: 10,
    batchSize: 5, // Free plan rate-limit friendly
  },
};

/**
 * Returns whether a platform is currently active and enabled in the system.
 */
export function isPlatformEnabled(platform: PlatformType): boolean {
  return PLATFORM_CONFIG[platform]?.enabled ?? false;
}

/**
 * Returns configuration settings for the requested platform.
 */
export function getPlatformConfig(platform: PlatformType): PlatformConfigItem {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    throw new Error(`Unsupported platform configuration requested: ${platform}`);
  }
  return config;
}
