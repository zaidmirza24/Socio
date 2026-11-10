import { NextResponse } from "next/server";
import { getCampaignCaptions } from "@/lib/supabase/captions";
import { createServerComponentClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = createServerComponentClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Team login required" },
        { status: 401 }
      );
    }

    const captions = await getCampaignCaptions();
    return NextResponse.json({ success: true, captions });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load captions";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

