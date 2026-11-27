import { NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { getCampaignCaptions } from "@/lib/supabase/captions";
import { requireUser } from "@/lib/supabase/require-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const captions = await getCampaignCaptions();
    return NextResponse.json({ success: true, captions });
  } catch (err: unknown) {
    return internalError(err, "Failed to load captions");
  }
}

