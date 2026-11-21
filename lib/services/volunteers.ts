import { createAdminClient } from "../supabase/admin.ts";
import type { PlatformType } from "../../types/database.ts";

export interface AccountInput {
  platform: PlatformType;
  handle: string;
  volunteer_name: string;
}

export interface KnownVolunteer {
  id: string;
  name: string;
  /** Platforms this volunteer already has an account on. */
  platforms: Set<PlatformType>;
}

export interface KnownAccount {
  platform: PlatformType;
  handle: string;
  volunteer_id: string | null;
}

export interface VolunteerAssignment {
  platform: PlatformType;
  handle: string;
  /** Existing volunteer id, or a temporary key (`new:<n>`) for one that must be created. */
  volunteerRef: string;
}

export interface NewVolunteerToCreate {
  ref: string;
  name: string;
}

/**
 * Decides which volunteer each account belongs to. Pure: no database access.
 *
 * Rules:
 * - An account that already exists keeps its volunteer (re-imports are idempotent).
 * - Otherwise accounts with the same name (case-insensitive) are grouped as ONE volunteer, as
 *   long as that volunteer does not already have an account on that platform.
 * - Two different handles on the same platform with the same name are treated as two
 *   different people who share a name, so a separate volunteer is created.
 */
export function assignVolunteers(
  inputs: AccountInput[],
  volunteers: KnownVolunteer[],
  accounts: KnownAccount[]
): { assignments: VolunteerAssignment[]; toCreate: NewVolunteerToCreate[] } {
  const existingByKey = new Map<string, string | null>();
  for (const a of accounts) existingByKey.set(`${a.platform}:${a.handle}`, a.volunteer_id);

  // name -> candidate volunteers (mutable copy so platforms fill up as we assign)
  const byName = new Map<string, { ref: string; platforms: Set<PlatformType> }[]>();
  for (const v of volunteers) {
    const key = v.name.trim().toLowerCase();
    const list = byName.get(key) ?? [];
    list.push({ ref: v.id, platforms: new Set(v.platforms) });
    byName.set(key, list);
  }

  const assignments: VolunteerAssignment[] = [];
  const toCreate: NewVolunteerToCreate[] = [];

  for (const input of inputs) {
    const key = `${input.platform}:${input.handle}`;
    const existing = existingByKey.get(key);
    if (existing) {
      assignments.push({ platform: input.platform, handle: input.handle, volunteerRef: existing });
      continue;
    }

    const nameKey = input.volunteer_name.trim().toLowerCase();
    const candidates = byName.get(nameKey) ?? [];
    let chosen = candidates.find((c) => !c.platforms.has(input.platform));
    if (!chosen) {
      chosen = { ref: `new:${toCreate.length}`, platforms: new Set() };
      toCreate.push({ ref: chosen.ref, name: input.volunteer_name.trim() });
      candidates.push(chosen);
      byName.set(nameKey, candidates);
    }
    chosen.platforms.add(input.platform);
    assignments.push({ platform: input.platform, handle: input.handle, volunteerRef: chosen.ref });
  }

  return { assignments, toCreate };
}

/**
 * Resolves volunteer ids for a batch of accounts, creating volunteers as needed.
 * Returns a map keyed `platform:handle` -> volunteer_id.
 */
export async function resolveVolunteerIds(inputs: AccountInput[]): Promise<Map<string, string>> {
  const admin = createAdminClient();

  const [{ data: vols, error: vErr }, { data: accs, error: aErr }] = await Promise.all([
    admin.from("volunteers").select("id, name"),
    admin.from("accounts").select("platform, handle, volunteer_id"),
  ]);
  if (vErr) throw new Error(`Failed to load volunteers: ${vErr.message}`);
  if (aErr) throw new Error(`Failed to load accounts: ${aErr.message}`);

  const platformsByVolunteer = new Map<string, Set<PlatformType>>();
  for (const a of accs ?? []) {
    if (!a.volunteer_id) continue;
    const set = platformsByVolunteer.get(a.volunteer_id) ?? new Set<PlatformType>();
    set.add(a.platform as PlatformType);
    platformsByVolunteer.set(a.volunteer_id, set);
  }

  const known: KnownVolunteer[] = (vols ?? []).map((v) => ({
    id: v.id as string,
    name: v.name as string,
    platforms: platformsByVolunteer.get(v.id as string) ?? new Set<PlatformType>(),
  }));
  const knownAccounts: KnownAccount[] = (accs ?? []).map((a) => ({
    platform: a.platform as PlatformType,
    handle: a.handle as string,
    volunteer_id: (a.volunteer_id as string | null) ?? null,
  }));

  const { assignments, toCreate } = assignVolunteers(inputs, known, knownAccounts);

  const createdIds = new Map<string, string>();
  if (toCreate.length > 0) {
    const { data: created, error } = await admin
      .from("volunteers")
      .insert(toCreate.map((v) => ({ name: v.name })))
      .select("id");
    if (error || !created || created.length !== toCreate.length) {
      throw new Error(`Failed to create volunteers: ${error?.message ?? "unexpected result"}`);
    }
    // Inserted rows come back in insertion order
    toCreate.forEach((v, i) => createdIds.set(v.ref, created[i].id as string));
  }

  const result = new Map<string, string>();
  for (const a of assignments) {
    const id = a.volunteerRef.startsWith("new:") ? createdIds.get(a.volunteerRef) : a.volunteerRef;
    if (id) result.set(`${a.platform}:${a.handle}`, id);
  }
  return result;
}

/** Renames a volunteer and keeps the denormalized accounts.volunteer_name in sync. */
export async function renameVolunteer(volunteerId: string, name: string): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("volunteers").update({ name, updated_at: now }).eq("id", volunteerId);
  if (error) throw new Error(`Failed to rename volunteer: ${error.message}`);
  const { error: accErr } = await admin
    .from("accounts")
    .update({ volunteer_name: name, updated_at: now })
    .eq("volunteer_id", volunteerId);
  if (accErr) throw new Error(`Failed to sync account names: ${accErr.message}`);
}
