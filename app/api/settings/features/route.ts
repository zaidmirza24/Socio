import { NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { requireUser } from "@/lib/supabase/require-admin";
import { getFeatureSettings } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/features
 * Lightweight feature-flag read for any signed-in team member (used by nav/command palette).
 */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    return NextResponse.json(await getFeatureSettings());
  } catch (err: unknown) {
    return internalError(err, "Could not load feature settings");
  }
}
