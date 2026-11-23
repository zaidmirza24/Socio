import type { PlatformType } from "../../types/database.ts";

/** A volunteer as offered in pickers (e.g. choosing who a collection run covers). */
export interface VolunteerOption {
  id: string;
  name: string;
  /** Platforms on which the volunteer has an ACTIVE account (the ones a run would collect). */
  platforms: PlatformType[];
}

/**
 * Builds picker options from volunteers and their active accounts. Pure. Volunteers without an
 * active account are left out: a run could not collect anything for them.
 */
export function buildVolunteerOptions(
  volunteers: { id: string; name: string }[],
  activeAccounts: { volunteer_id: string | null; platform: PlatformType }[]
): VolunteerOption[] {
  const platformsByVolunteer = new Map<string, Set<PlatformType>>();
  for (const a of activeAccounts) {
    if (!a.volunteer_id) continue;
    const set = platformsByVolunteer.get(a.volunteer_id) ?? new Set<PlatformType>();
    set.add(a.platform);
    platformsByVolunteer.set(a.volunteer_id, set);
  }
  return volunteers
    .filter((v) => platformsByVolunteer.has(v.id))
    .map((v) => ({ id: v.id, name: v.name, platforms: [...(platformsByVolunteer.get(v.id) ?? [])] }));
}
