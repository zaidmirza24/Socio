import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { confirmDestructive } from "./confirm-destructive.mjs";

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
  // Scheduled runs live on Apify too. Deleting only our rows would leave those Apify Schedules
  // firing (and billing) with nothing in the app to see or stop them, so refuse instead.
  const { count: scheduleCount, error: scheduleErr } = await supabase
    .from("scraper_schedules")
    .select("*", { count: "exact", head: true });
  if (scheduleErr) {
    console.error("Could not check scraper_schedules:", scheduleErr.message);
    process.exit(1);
  }
  if ((scheduleCount ?? 0) > 0) {
    console.error(
      `Refusing to clean: ${scheduleCount} schedule(s) exist. Delete them on the Scheduler page ` +
        "(/dashboard/schedules) first, which also removes them from Apify, then re-run."
    );
    process.exit(1);
  }

  console.log("Cleaning database tables (preserving table schemas and profiles)...");

  // Children before parents (accounts reference volunteers).
  const tables = [
    "refresh_queue",
    "metric_snapshots",
    "review_queue",
    "caption_approved_variants",
    "matched_posts",
    "campaign_captions",
    "post_snapshots",
    "posts",
    "account_snapshots",
    "collection_runs",
    "accounts",
    "volunteers",
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

await confirmDestructive("Delete all volunteers, accounts, posts, snapshots, captions, runs and queued refreshes", url);
await cleanDatabase();
