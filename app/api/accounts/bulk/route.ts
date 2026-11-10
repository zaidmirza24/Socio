import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";

const accountItemSchema = z.object({
  volunteer_name: z.string().min(1, "Volunteer name is required").trim(),
  handle: z
    .string()
    .min(1, "Handle is required")
    .transform((v) => v.replace(/^@/, "").trim().toLowerCase()),
  platform: z.enum(["instagram", "facebook", "x"]).default("instagram"),
  status: z.enum(["active", "paused", "archived"]).default("active"),
});

const bulkAccountsSchema = z.object({
  accounts: z
    .array(accountItemSchema)
    .min(1, "At least one account is required")
    .max(500, "Maximum 500 accounts per bulk batch"),
});

async function getAuthenticatedAdmin() {
  const supabase = createServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { authorized: false as const, status: 401, error: "Unauthorized: Team login required" };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { authorized: false as const, status: 403, error: "Forbidden: Admin privileges required" };
  }

  return { authorized: true as const, user };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedAdmin();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const parseResult = bulkAccountsSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { accounts } = parseResult.data;

    // Deduplicate within the payload by (platform, handle) keeping the latest entry
    const uniqueMap = new Map<string, typeof accounts[number]>();
    for (const acc of accounts) {
      const key = `${acc.platform}:${acc.handle}`;
      uniqueMap.set(key, acc);
    }

    const now = new Date().toISOString();
    const rowsToUpsert = Array.from(uniqueMap.values()).map((acc) => ({
      volunteer_name: acc.volunteer_name,
      handle: acc.handle,
      platform: acc.platform,
      status: acc.status,
      updated_at: now,
    }));

    const admin = createAdminClient();

    // Idempotent upsert matching UNIQUE(platform, handle)
    const { data, error } = await admin
      .from("accounts")
      .upsert(rowsToUpsert, {
        onConflict: "platform,handle",
        ignoreDuplicates: false,
      })
      .select("id, platform, handle, volunteer_name, status, added_at, updated_at");

    if (error) {
      return NextResponse.json(
        { error: `Database error during bulk upsert: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: `Successfully processed ${rowsToUpsert.length} volunteer accounts (${uniqueMap.size} unique).`,
        count: data ? data.length : rowsToUpsert.length,
        accounts: data || [],
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

