import { NextRequest, NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { resolveVolunteerIds } from "@/lib/services/volunteers";
import { fetchAllRows } from "@/lib/supabase/paginate";

type AccountStatus = "active" | "paused" | "archived";

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

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;

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
    const uniqueAccounts = Array.from(uniqueMap.values());
    const admin = createAdminClient();

    // Re-importing a list must not reactivate accounts an admin paused or archived. "active" is
    // also what the importer sends when a row says nothing about status, so an existing account
    // keeps its current status unless the row explicitly asks for a non-active one (e.g. "paused").
    const existing = await fetchAllRows<{ platform: string; handle: string; status: AccountStatus }>((from, to) =>
      admin.from("accounts").select("platform, handle, status").order("id").range(from, to)
    );
    const existingStatus = new Map(existing.map((a) => [`${a.platform}:${a.handle}`, a.status]));
    const statusFor = (acc: (typeof accounts)[number]): AccountStatus => {
      const current = existingStatus.get(`${acc.platform}:${acc.handle}`);
      if (current === undefined) return acc.status;
      return acc.status === "active" ? current : acc.status;
    };
    // Same-name rows on different platforms become one volunteer (IG + FB + X)
    const volunteerIds = await resolveVolunteerIds(
      uniqueAccounts.map((a) => ({ platform: a.platform, handle: a.handle, volunteer_name: a.volunteer_name }))
    );
    const rowsToUpsert = uniqueAccounts.map((acc) => ({
      volunteer_id: volunteerIds.get(`${acc.platform}:${acc.handle}`) ?? null,
      volunteer_name: acc.volunteer_name,
      handle: acc.handle,
      platform: acc.platform,
      status: statusFor(acc),
      updated_at: now,
    }));

    // Idempotent upsert matching UNIQUE(platform, handle)
    const { data, error } = await admin
      .from("accounts")
      .upsert(rowsToUpsert, {
        onConflict: "platform,handle",
        ignoreDuplicates: false,
      })
      .select("id, platform, handle, volunteer_id, volunteer_name, status, added_at, updated_at");

    if (error) {
      return internalError(error, "Database error during bulk upsert");
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
    return internalError(err, "Internal Server Error");
  }
}

