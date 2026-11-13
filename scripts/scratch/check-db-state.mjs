import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim();
const key = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
const supabase = createClient(url, key);

async function main() {
  // ── matched_posts grouped by campaign ──────────────────────────────────────
  console.log("\n━━━ MATCHED POSTS (verified) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const { data: matched } = await supabase
    .from("matched_posts")
    .select(`
      id,
      platform_post_id,
      post_url,
      match_tier,
      match_confidence,
      tracking_status,
      posted_at,
      normalized_caption,
      accounts ( handle, volunteer_name ),
      campaign_captions ( title )
    `)
    .order("posted_at", { ascending: false });

  if (!matched || matched.length === 0) {
    console.log("  (no matched posts found)");
  } else {
    // Group by campaign
    const byCampaign = {};
    for (const p of matched) {
      const title = p.campaign_captions?.title ?? "unknown";
      if (!byCampaign[title]) byCampaign[title] = [];
      byCampaign[title].push(p);
    }

    for (const [campaignTitle, posts] of Object.entries(byCampaign)) {
      console.log(`📢 Campaign: "${campaignTitle}"  (${posts.length} verified posts)`);
      for (const p of posts) {
        const handle = p.accounts?.handle ?? "?";
        const name   = p.accounts?.volunteer_name ?? "";
        const cap    = (p.normalized_caption ?? "").slice(0, 120);
        console.log(`   ├─ @${handle} (${name})`);
        console.log(`   │  URL : ${p.post_url}`);
        console.log(`   │  Tier: ${p.match_tier} | Confidence: ${p.match_confidence}`);
        console.log(`   │  Caption (normalized, first 120 chars):`);
        console.log(`   │  "${cap}${cap.length >= 120 ? '…' : ''}"`);
        console.log(`   │`);
      }
      console.log("");
    }
  }

  // ── campaign_captions ──────────────────────────────────────────────────────
  console.log("\n━━━ CAMPAIGN CAPTIONS in DB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const { data: captions } = await supabase
    .from("campaign_captions")
    .select("id, title, status, released_at, canonical_caption")
    .order("released_at", { ascending: false });

  for (const c of captions ?? []) {
    console.log(`  [${c.status}] "${c.title}"`);
    console.log(`          Released : ${c.released_at}`);
    console.log(`          Caption  : "${(c.canonical_caption ?? "").slice(0, 150)}"`);
    console.log("");
  }

  // ── review_queue ───────────────────────────────────────────────────────────
  console.log("\n━━━ REVIEW QUEUE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const { data: queue } = await supabase
    .from("review_queue")
    .select(`
      id,
      platform_post_id,
      post_url,
      similarity_score,
      status,
      candidate_caption,
      accounts ( handle ),
      campaign_captions ( title )
    `)
    .order("similarity_score", { ascending: false });

  if (!queue || queue.length === 0) {
    console.log("  (review queue is empty)");
  } else {
    for (const q of queue) {
      const cap = (q.candidate_caption ?? "").slice(0, 100);
      console.log(`  [${q.status}] @${q.accounts?.handle} → campaign: "${q.campaign_captions?.title}"`);
      console.log(`         Similarity: ${q.similarity_score}`);
      console.log(`         Post: ${q.post_url}`);
      console.log(`         Caption: "${cap}${cap.length >= 100 ? '…' : ''}"`);
      console.log("");
    }
  }

  // ── summary counts ─────────────────────────────────────────────────────────
  console.log("\n━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  const { count: matchedCount }  = await supabase.from("matched_posts").select("*", { count: "exact", head: true });
  const { count: queueCount }    = await supabase.from("review_queue").select("*", { count: "exact", head: true });
  const { count: accountCount }  = await supabase.from("accounts").select("*", { count: "exact", head: true });
  const { count: captionCount }  = await supabase.from("campaign_captions").select("*", { count: "exact", head: true });
  const { count: snapshotCount } = await supabase.from("metric_snapshots").select("*", { count: "exact", head: true });

  console.log(`  Accounts          : ${accountCount}`);
  console.log(`  Campaign captions : ${captionCount}`);
  console.log(`  Matched posts ✓   : ${matchedCount}`);
  console.log(`  Review queue ⏳   : ${queueCount}`);
  console.log(`  Metric snapshots  : ${snapshotCount}`);
  console.log("");
}

main().catch(console.error);

