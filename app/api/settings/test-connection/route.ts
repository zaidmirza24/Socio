import { NextRequest, NextResponse } from "next/server";
import { getApifyClient } from "@/lib/apify/client";
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

    const results: {
      supabase: { ok: boolean; message: string; accountCount?: number };
      apify: { ok: boolean; message: string; username?: string };
    } = {
      supabase: { ok: false, message: "Testing..." },
      apify: { ok: false, message: "Testing..." },
    };

    // 1. Test Supabase
    try {
      const admin = createAdminClient();
      const { count, error } = await admin
        .from("accounts")
        .select("*", { count: "exact", head: true });

      if (error) {
        results.supabase = { ok: false, message: `Supabase error: ${error.message}` };
      } else {
        results.supabase = {
          ok: true,
          message: "Connected to Supabase PostgreSQL",
          accountCount: count ?? 0,
        };
      }
    } catch (e: unknown) {
      results.supabase = {
        ok: false,
        message: e instanceof Error ? e.message : "Failed to connect to Supabase",
      };
    }

    // 2. Test Apify
    try {
      const apifyClient = getApifyClient();
      const user = await apifyClient.user().get();
      if (user && user.id) {
        results.apify = {
          ok: true,
          message: "Connected to Apify Cloud API",
          username: user.username,
        };
      } else {
        results.apify = { ok: false, message: "Apify returned an invalid user profile" };
      }
    } catch (e: unknown) {
      results.apify = {
        ok: false,
        message: e instanceof Error ? e.message : "Failed to connect to Apify API",
      };
    }

    return NextResponse.json({
      success: results.supabase.ok && results.apify.ok,
      results,
      env: {
        supabaseUrlConfigured: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        apifyTokenConfigured: !!process.env.APIFY_API_TOKEN,
        apifyTaskIdConfigured: !!process.env.APIFY_TASK_ID,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Connection test failed";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

