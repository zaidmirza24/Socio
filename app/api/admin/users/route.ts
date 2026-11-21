import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerComponentClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { safeEqual } from "@/lib/services/crypto";

const createUserSchema = z.object({
  email: z.string().email("Invalid email address").toLowerCase().trim(),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  full_name: z.string().min(1, "Full name is required").trim(),
  role: z.enum(["admin", "member"]).default("member"),
});

const deleteUserSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
});

async function verifyAdminOrBootstrap(request: NextRequest) {
  const admin = createAdminClient();

  // Check if system has any profiles
  const { count, error: countError } = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true });

  // Fail closed: a failed count must never be read as "no users yet" (which enables bootstrap).
  if (countError || count === null) {
    return { authorized: false, isBootstrap: false, error: "Could not verify existing users. Try again." };
  }

  const isBootstrap = count === 0;

  if (isBootstrap) {
    // This route is outside the auth middleware, so an empty profiles table must NOT mean
    // "anyone can become admin". Bootstrap needs the secret BOOTSTRAP_TOKEN from the server env.
    const expected = getServerEnv().BOOTSTRAP_TOKEN;
    const provided = request.headers.get("x-bootstrap-token") ?? "";
    if (expected && provided && safeEqual(provided, expected)) {
      return { authorized: true, isBootstrap: true };
    }
    return {
      authorized: false,
      isBootstrap: false,
      error:
        "No admin exists yet. Create the first user in Supabase Auth (it becomes admin automatically), or set BOOTSTRAP_TOKEN and send it as the x-bootstrap-token header.",
    };
  }

  // If not bootstrap, check if the current requester is an authenticated Admin
  const supabase = createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { authorized: false, isBootstrap: false, error: "Authentication required" };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { authorized: false, isBootstrap: false, error: "Only administrators can perform this action" };
  }

  return { authorized: true, isBootstrap: false, user };
}

export async function GET(request: NextRequest) {
  try {
    const authCheck = await verifyAdminOrBootstrap(request);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: users, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve users";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authCheck = await verifyAdminOrBootstrap(request);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parseResult = createUserSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { email, password, full_name } = parseResult.data;
    // If it's the very first user bootstrapping the system, enforce 'admin' role
    const role = authCheck.isBootstrap ? "admin" : parseResult.data.role;

    const admin = createAdminClient();

    // 1. Create user in Supabase Auth via admin API
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
      // Roles live in app metadata, which only the service role can write. The profile
      // trigger ignores any role in user metadata (that is user-controlled at signup).
      app_metadata: { role },
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || "Failed to create user in Supabase Auth" },
        { status: 400 }
      );
    }

    // 2. Ensure profile is upserted in the profiles table
    const { data: profileData, error: profileError } = await admin
      .from("profiles")
      .upsert(
        {
          id: authData.user.id,
          email,
          full_name,
          role,
        },
        { onConflict: "id" }
      )
      .select()
      .single();

    if (profileError) {
      return NextResponse.json(
        {
          warning: "User created in Auth, but profile sync failed",
          error: profileError.message,
          user: { id: authData.user.id, email },
        },
        { status: 207 }
      );
    }

    return NextResponse.json(
      {
        message: authCheck.isBootstrap
          ? "Initial Admin user registered successfully!"
          : `Team member ${email} registered successfully as ${role}`,
        user: {
          id: authData.user.id,
          email,
          full_name,
          role,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to register team user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authCheck = await verifyAdminOrBootstrap(request);
    if (!authCheck.authorized || authCheck.isBootstrap) {
      return NextResponse.json({ error: "Only administrators can delete team users" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parseResult = deleteUserSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json({ error: "Valid userId is required" }, { status: 400 });
    }

    const { userId } = parseResult.data;

    // Prevent admin from deleting their own user
    if (authCheck.user && authCheck.user.id === userId) {
      return NextResponse.json(
        { error: "You cannot delete your own admin account while logged in" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Delete from auth.users (cascades to profiles)
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Team user deleted successfully" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete team user";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

