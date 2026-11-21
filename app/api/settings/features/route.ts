import { NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { createServerComponentClient } from "@/lib/supabase/server";
import { getFeatureSettings } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/features
 * Lightweight feature-flag read for any signed-in team member (used by nav/command palette).
 */
export async function GET() {
  const supabase = createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getFeatureSettings());
  } catch (err: unknown) {
    return internalError(err, "Could not load feature settings");
  }
}
