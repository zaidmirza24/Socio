import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    if (error) {
      return NextResponse.json({ count: 0 }, { status: 200 });
    }

    return NextResponse.json({ count: count ?? 0 });
  } catch (err) {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }
}

