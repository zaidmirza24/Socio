import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { getFeatureSettings } from "@/lib/services/settings";
import { matchStoredPosts } from "@/lib/services/match-stored-posts";

/**
 * POST /api/admin/match-stored
 *
 * Admin-only. Labels stored posts against the active captions (called automatically after the
 * caption list changes). A no-op while the caption filter is OFF. Idempotent.
 */
export async function POST() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { campaign_captions_enabled } = await getFeatureSettings();
    if (!campaign_captions_enabled) {
      return NextResponse.json({ success: true, skipped: true, message: "Caption filter is OFF; nothing to match." });
    }
    const summary = await matchStoredPosts();
    return NextResponse.json({ success: true, ...summary });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Matching failed" },
      { status: 500 }
    );
  }
}
