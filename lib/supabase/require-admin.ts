import { NextResponse } from "next/server";
import { createServerComponentClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The ONE place that decides who the caller is and whether they may act.
 * API routes use requireUser / requireAdmin (ready-made 401/403 responses); server actions use
 * checkCaller or verifyAdminCaller (plain objects, not responses). Do not re-implement this check.
 */

export type CallerRole = "member" | "admin";

export type CallerCheck =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export async function checkCaller(required: CallerRole): Promise<CallerCheck> {
  const {
    data: { user },
  } = await (await createServerComponentClient()).auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized: Team login required" };
  }
  if (required === "member") return { ok: true, userId: user.id };

  // Read with the service role: a member's own RLS view of profiles must not decide this.
  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden: administrators only" };
  }
  return { ok: true, userId: user.id };
}

export type AdminGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export type UserGuardResult = AdminGuardResult;

async function guard(required: CallerRole): Promise<AdminGuardResult> {
  const check = await checkCaller(required);
  if (check.ok) return check;
  return { ok: false, response: NextResponse.json({ error: check.error }, { status: check.status }) };
}

/** Route-handler guard: requires any signed-in team member. Returns the user id or a ready 401. */
export function requireUser(): Promise<UserGuardResult> {
  return guard("member");
}

/** Route-handler guard: requires an admin. Returns the user id or a ready 401/403. */
export function requireAdmin(): Promise<AdminGuardResult> {
  return guard("admin");
}

/**
 * Server-action guard for admin-only actions:
 * `{ authorized: true, user: { id } }` or `{ authorized: false, error }`.
 */
export async function verifyAdminCaller(): Promise<
  { authorized: true; user: { id: string } } | { authorized: false; error: string }
> {
  const check = await checkCaller("admin");
  return check.ok
    ? { authorized: true, user: { id: check.userId } }
    : { authorized: false, error: check.error };
}

/** Server-component check: is the signed-in user an admin? Used only to show admin controls; the API re-checks. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  return (await checkCaller("admin")).ok;
}
