import { NextRequest, NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireUser } from "@/lib/supabase/require-admin";
import { resolveVolunteerIds, renameVolunteer } from "@/lib/services/volunteers";
import { fetchAllRows } from "@/lib/supabase/paginate";

const createAccountSchema = z
  .object({
    handle: z.string().min(1, "Handle is required").transform((v) => v.replace(/^@/, "").trim().toLowerCase()),
    volunteer_name: z.string().trim().optional(),
    /** Attach the account to an existing volunteer (e.g. one that was missed at import time). */
    volunteer_id: z.string().uuid("Invalid volunteer ID").optional(),
    platform: z.enum(["instagram", "facebook", "x"]).default("instagram"),
    status: z.enum(["active", "paused", "archived"]).default("active"),
  })
  .refine((v) => !!v.volunteer_id || !!v.volunteer_name, {
    message: "Volunteer name is required",
    path: ["volunteer_name"],
  });

const updateAccountSchema = z.object({
  id: z.string().uuid("Invalid account ID"),
  handle: z.string().min(1).transform((v) => v.replace(/^@/, "").trim().toLowerCase()).optional(),
  volunteer_name: z.string().min(1).trim().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

export async function GET() {
  try {
    const guard = await requireUser();
    if (!guard.ok) return guard.response;

    const admin = createAdminClient();

    // 1. Fetch all accounts (paginated: Supabase caps a response at 1000 rows)
    const accounts = await fetchAllRows((from, to) =>
      admin
        .from("accounts")
        .select("id, platform, handle, volunteer_id, volunteer_name, status, added_at, updated_at")
        .order("added_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    );

    if (accounts.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    // 2. Post counts and latest followers come from the account_stats SQL view
    const stats = await fetchAllRows((from, to) =>
      admin
        .from("account_stats")
        .select("account_id, posts_count, followers")
        .order("account_id", { ascending: true })
        .range(from, to)
    ).catch((err: unknown) => {
      console.error("[accounts] account_stats unavailable (apply migration 20261124):", err);
      return [] as Array<{ account_id: string; posts_count: number; followers: number | null }>;
    });
    const statsById = new Map(stats.map((s) => [s.account_id, s]));

    const enrichedAccounts = accounts.map((acc) => ({
      ...acc,
      postsCount: Number(statsById.get(acc.id)?.posts_count ?? 0),
      followers: statsById.get(acc.id)?.followers ?? null,
    }));

    return NextResponse.json({ accounts: enrichedAccounts });
  } catch (err: unknown) {
    return internalError(err, "Internal Server Error");
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const body = await request.json().catch(() => ({}));
    const parseResult = createAccountSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { handle, platform, status, volunteer_id } = parseResult.data;
    let volunteer_name = parseResult.data.volunteer_name ?? "";
    const admin = createAdminClient();

    let resolvedVolunteerId: string | null;
    if (volunteer_id) {
      // Explicit volunteer: they must exist and have no account on this platform yet.
      const { data: vol } = await admin.from("volunteers").select("id, name").eq("id", volunteer_id).maybeSingle();
      if (!vol) {
        return NextResponse.json({ error: "Volunteer not found." }, { status: 404 });
      }
      const { data: existing } = await admin
        .from("accounts")
        .select("id")
        .eq("volunteer_id", volunteer_id)
        .eq("platform", platform)
        .limit(1);
      if (existing && existing.length > 0) {
        return NextResponse.json(
          { error: `This volunteer already has a ${platform} account.` },
          { status: 409 }
        );
      }
      volunteer_name = vol.name as string;
      resolvedVolunteerId = volunteer_id;
    } else {
      // Same-name accounts on different platforms join one volunteer (max one account/platform)
      const volunteerIds = await resolveVolunteerIds([{ platform, handle, volunteer_name }]);
      resolvedVolunteerId = volunteerIds.get(`${platform}:${handle}`) ?? null;
    }

    const { data, error } = await admin
      .from("accounts")
      .insert({
        handle,
        volunteer_name,
        volunteer_id: resolvedVolunteerId,
        platform,
        status,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `Account @${handle} on ${platform} is already registered.` },
          { status: 409 }
        );
      }
      return internalError(error, "Database error while saving the account");
    }

    return NextResponse.json({ account: data }, { status: 201 });
  } catch (err: unknown) {
    return internalError(err, "Internal Server Error");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const body = await request.json().catch(() => ({}));
    const parseResult = updateAccountSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { id, ...updates } = parseResult.data;
    const admin = createAdminClient();

    // Update the account first: if it fails (e.g. the new handle is taken), nothing else changed.
    const { data, error } = await admin
      .from("accounts")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `Another account already uses @${updates.handle ?? "that handle"} on this platform.` },
          { status: 409 }
        );
      }
      return internalError(error, "Database error while saving the account");
    }

    // Renaming a volunteer renames them on all of their platform accounts
    if (updates.volunteer_name && data?.volunteer_id) {
      await renameVolunteer(data.volunteer_id as string, updates.volunteer_name);
    }

    return NextResponse.json({ account: data });
  } catch (err: unknown) {
    return internalError(err, "Internal Server Error");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const idParse = z.string().uuid("A valid account ID is required").safeParse(url.searchParams.get("id"));

    if (!idParse.success) {
      return NextResponse.json({ error: idParse.error.issues[0]?.message ?? "Invalid account ID" }, { status: 400 });
    }
    const id = idParse.data;

    const admin = createAdminClient();
    const { error } = await admin.from("accounts").delete().eq("id", id);

    if (error) {
      return internalError(error, "Database error while saving the account");
    }

    return NextResponse.json({ success: true, message: "Account deleted successfully" });
  } catch (err: unknown) {
    return internalError(err, "Internal Server Error");
  }
}

