import type { PlatformFilter } from "@/lib/supabase/queries";

/** Parses a `?platform=` query value; anything unknown means "all". */
export function parsePlatformFilter(raw: string | undefined | null): PlatformFilter {
  return raw === "instagram" || raw === "facebook" || raw === "x" ? raw : "all";
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}
