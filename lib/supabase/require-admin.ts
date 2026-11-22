import { NextResponse } from "next/server";
import { createServerComponentClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export type UserGuardResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

/** Route-handler guard: requires any signed-in team member. Returns the user id or a ready 401. */
export async function requireUser(): Promise<UserGuardResult> {
  const {
    data: { user },
  } = await createServerComponentClient().auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized: Team login required" }, { status: 401 }) };
  }
  return { ok: true, userId: user.id };
}

/**
 * Route-handler guard: requires a signed-in user whose profile role is 'admin'.
 * Returns the user id on success, or a ready-made 401/403 response.
 */
export async function requireAdmin(): Promise<AdminGuardResult> {
  const supabase = createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized: Team login required" }, { status: 401 }) };
  }

  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();

  if (!profile || profile.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden: administrators only" }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id };
}
