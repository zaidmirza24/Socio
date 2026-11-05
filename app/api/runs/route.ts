import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerComponentClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabaseUser = createServerComponentClient();
    const { data: { user } } = await supabaseUser.auth.getUser();

    const authHeader = request.headers.get("authorization");
    const isDev = process.env.NODE_ENV !== "production";

    if (!user && !(isDev && authHeader === "Bearer dev-override")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: runs, error } = await admin
      .from("collection_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ runs: runs || [] });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to load runs";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

