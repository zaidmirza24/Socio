import { NextResponse } from "next/server";
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

  return NextResponse.json(await getFeatureSettings());
}
