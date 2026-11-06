import { NextRequest, NextResponse } from "next/server";
import { createServerComponentClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerComponentClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const admin = createAdminClient();

    // Check count of profiles to see if the system has any users yet
    const { count, error: countError } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true });

    const totalUsers = count ?? 0;
    const isFirstUser = totalUsers === 0;

    if (authError || !user) {
      return NextResponse.json({
        user: null,
        profile: null,
        isAdmin: false,
        isFirstUser,
        totalUsers,
      });
    }

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
    const message = err instanceof Error ? err.message : "Failed to fetch user session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

