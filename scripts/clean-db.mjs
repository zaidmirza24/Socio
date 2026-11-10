import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// Load environment variables from .env.local
const envContent = fs.readFileSync(".env.local", "utf8");
const url = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim();
const serviceRoleKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim();

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

async function cleanDatabase() {
  console.log("Cleaning database tables (preserving table schemas and profiles)...");

  const tables = [
    "metric_snapshots",
    "review_queue",
    "caption_approved_variants",
    "matched_posts",
    "campaign_captions",
    "post_snapshots",
    "posts",
    "collection_runs",
    "accounts",
  ];

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      console.error(`✗ Error cleaning ${table}:`, error.message);
    } else {
      console.log(`✓ Cleaned ${table}`);
    }
  }

  console.log("\n--- Verification ---");
  for (const table of [...tables, "profiles"]) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    console.log(`${table}: ${error ? error.message : `${count} rows`}`);
  }
}

cleanDatabase();

