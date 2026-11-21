import { NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { createServerComponentClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-user data read with session cookies: never prerender or cache.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createServerComponentClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    // Anonymous callers learn nothing about the system (not even how many users exist).
    if (authError || !user) {
      return NextResponse.json({ user: null, profile: null, isAdmin: false });
    }

    const admin = createAdminClient();
    const { count } = await admin.from("profiles").select("*", { count: "exact", head: true });
    const totalUsers = count ?? 0;
    const isFirstUser = totalUsers === 0;

    // Fetch user's profile
    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    const isAdmin = profile?.role === "admin";

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
      },
      profile: profile || {
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || null,
        role: "member",
      },
      isAdmin,
      isFirstUser,
      totalUsers,
    });
  } catch (err: unknown) {
    return internalError(err, "Failed to fetch user session");
  }
}

