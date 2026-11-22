/**
 * Links to volunteer pages.
 *
 * - A volunteer page (`/dashboard/volunteers/v/<id>`) combines ALL of a volunteer's accounts
 *   (Instagram, Facebook, X).
 * - An account page (`/dashboard/volunteers/<handle>?platform=<p>`) shows one platform account.
 *   It is the fallback for legacy rows that have no volunteer id.
 */

export type VolunteerLinkSource = "leaderboard" | "matrix" | "volunteers" | "posts" | "accounts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVolunteerId(value: string): boolean {
  return UUID_RE.test(value);
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/** One platform account's page. */
export function accountProfileHref(handle: string, platform: string, from?: VolunteerLinkSource): string {
  return withQuery(`/dashboard/volunteers/${encodeURIComponent(handle)}`, { platform, from });
}

/**
 * The volunteer-level page when the volunteer is known, otherwise the single-account page.
 */
export function volunteerProfileHref(args: {
  volunteerId: string | null | undefined;
  handle: string;
  platform: string;
  from?: VolunteerLinkSource;
}): string {
  if (args.volunteerId && isVolunteerId(args.volunteerId)) {
    return withQuery(`/dashboard/volunteers/v/${args.volunteerId}`, { from: args.from });
  }
  return accountProfileHref(args.handle, args.platform, args.from);
}
