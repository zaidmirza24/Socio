import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { requireAdmin, requireUser } from "@/lib/supabase/require-admin";
import { deleteVolunteer, VolunteerNotFoundError } from "@/lib/services/volunteers";
import { buildVolunteerOptions } from "@/lib/services/volunteer-options";
import type { PlatformType } from "@/types/database";

// Per-user data: never prerender or cache.
export const dynamic = "force-dynamic";

/**
 * GET /api/volunteers
 * Lightweight list for pickers (e.g. choosing who a collection run covers). Only volunteers that
 * have at least one active account are listed, since the others cannot be collected anyway.
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const admin = createAdminClient();
    const [volunteers, accounts] = await Promise.all([
      fetchAllRows<{ id: string; name: string }>((from, to) =>
        admin.from("volunteers").select("id, name").order("name").order("id").range(from, to)
      ),
      fetchAllRows<{ volunteer_id: string | null; platform: PlatformType }>((from, to) =>
        admin
          .from("accounts")
          .select("volunteer_id, platform")
          .eq("status", "active")
          .not("volunteer_id", "is", null)
          .order("id")
          .range(from, to)
      ),
    ]);

    return NextResponse.json({ volunteers: buildVolunteerOptions(volunteers, accounts) });
  } catch (err: unknown) {
    return internalError(err, "Could not load volunteers");
  }
}

const deleteQuerySchema = z.object({
  id: z.string().uuid("A valid volunteer ID is required"),
  // Required and explicit: deleting collected data must never happen by omission.
  deleteData: z.enum(["true", "false"], { errorMap: () => ({ message: "deleteData must be 'true' or 'false'" }) }),
});

/**
 * DELETE /api/volunteers?id=<uuid>&deleteData=true|false
 * Admin-only. deleteData=true removes the volunteer's accounts, posts and snapshots too;
 * deleteData=false keeps them (accounts are archived and no longer collected).
 */
export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const parsed = deleteQuerySchema.safeParse({
    id: url.searchParams.get("id"),
    deleteData: url.searchParams.get("deleteData"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const result = await deleteVolunteer(parsed.data.id, parsed.data.deleteData === "true");
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof VolunteerNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return internalError(err, "Could not delete the volunteer");
  }
}
