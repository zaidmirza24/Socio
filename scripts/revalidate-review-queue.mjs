/**
 * revalidate-review-queue.mjs
 *
 * Re-scores all pending review_queue items against CURRENT campaign captions.
 * Removes any item that no longer meets the ≥0.90 similarity threshold.
 * Keeps only genuinely fuzzy-matched posts.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim();
const key = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
const supabase = createClient(url, key);

const FUZZY_THRESHOLD = 0.90;

function normalizeCaption(raw) {
  if (!raw) return "";
  let s = raw.normalize("NFKC");
  s = s.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u00AD]/g, "");
  s = s.replace(/[\u201C\u201D\u00AB\u00BB\u201E\u201F]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'");
  s = s.replace(/[\u2013\u2014\u2015\u2212]/g, "-");
  s = s.replace(/\s*(?:\.\.\.\s*more|…\s*more|…|\.\.\.)?\s*$/i, "");
  s = s.replace(/https?:\/\/[^\s]+/gi, "{{url}}");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[^\S\r\n]+/g, " ");
  return s.split("\n").map((l) => l.trim()).join("\n").trim().toLowerCase();
}

function computeHash(normalized) {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

// Trigram-based similarity (more accurate than cosine for text matching)
function trigramSimilarity(a, b) {
  if (!a || !b) return 0;
  
  function trigrams(s) {
    const set = new Set();
    const padded = `  ${s}  `;
    for (let i = 0; i < padded.length - 2; i++) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  }

  const triA = trigrams(a);
  const triB = trigrams(b);
  let intersection = 0;
  for (const t of triA) {
    if (triB.has(t)) intersection++;
  }
  return (2 * intersection) / (triA.size + triB.size);
}

async function main() {
  console.log("\n================================================================");
  console.log("  RE-VALIDATING REVIEW QUEUE against current campaign captions  ");
  console.log("================================================================\n");

  // 1. Load current campaign captions
  const { data: campaigns } = await supabase
    .from("campaign_captions")
    .select("id, title, canonical_caption, normalized_caption, caption_hash")
    .eq("status", "active");

  if (!campaigns?.length) {
    console.error("No active campaigns found.");
    process.exit(1);
  }

  console.log("Current campaigns:");
  for (const c of campaigns) {
    console.log(`  • "${c.title}"`);
    console.log(`    Caption: "${(c.canonical_caption ?? "").slice(0, 80)}..."`);
  }

  // 2. Load all pending review_queue items
  const { data: queueItems } = await supabase
    .from("review_queue")
    .select("id, platform_post_id, post_url, candidate_caption, accounts(handle)")
    .eq("status", "pending");

  if (!queueItems?.length) {
    console.log("\nReview queue is already empty.");
    return;
  }

  console.log(`\nRe-evaluating ${queueItems.length} review queue items...\n`);

  const toKeep = [];
  const toDelete = [];

  for (const item of queueItems) {
    const rawCaption = item.candidate_caption ?? "";
    if (!rawCaption.trim()) {
      toDelete.push({ item, reason: "empty caption" });
      continue;
    }

    const normPost = normalizeCaption(rawCaption);
    const postHash = computeHash(normPost);

    let bestScore = 0;
    let bestCampaign = null;

    for (const campaign of campaigns) {
      // Exact hash match → this would be tier1, shouldn't be in queue but handle it
      if (postHash === campaign.caption_hash) {
        bestScore = 1.0;
        bestCampaign = campaign;
        break;
      }

      // Trigram similarity against current normalized caption
      const score = trigramSimilarity(normPost, campaign.normalized_caption ?? "");
      if (score > bestScore) {
        bestScore = score;
        bestCampaign = campaign;
      }
    }

    const roundedScore = Math.round(bestScore * 1000) / 1000;

    if (bestScore >= FUZZY_THRESHOLD && bestCampaign) {
      toKeep.push({ item, score: roundedScore, campaign: bestCampaign });
    } else {
      toDelete.push({ item, reason: `score ${roundedScore} < ${FUZZY_THRESHOLD}`, score: roundedScore });
    }
  }

  // 3. Update kept items with correct campaign_id and score
  console.log(`━━━ Keeping ${toKeep.length} genuine fuzzy matches ━━━`);
  for (const { item, score, campaign } of toKeep) {
    await supabase
      .from("review_queue")
      .update({
        caption_id: campaign.id,
        similarity_score: score,
      })
      .eq("id", item.id);

    const handle = item.accounts?.handle ?? "?";
    console.log(`  ✓ @${handle} → "${campaign.title}" (score: ${score})`);
    console.log(`    "${(item.candidate_caption ?? "").slice(0, 80)}..."`);
  }

  // 4. Delete items that don't meet threshold
  console.log(`\n━━━ Removing ${toDelete.length} items below threshold ━━━`);
  const deleteIds = toDelete.map((d) => d.item.id);
  
  if (deleteIds.length > 0) {
    const { error: delErr } = await supabase
      .from("review_queue")
      .delete()
      .in("id", deleteIds);

    if (delErr) {
      console.error("  ✗ Delete error:", delErr.message);
    } else {
      for (const { item, reason } of toDelete) {
        const handle = item.accounts?.handle ?? "?";
        console.log(`  ✗ @${handle} removed (${reason})`);
      }
    }
  }

  // 5. Final summary
  const { count: finalCount } = await supabase
    .from("review_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  console.log("\n================================================================");
  console.log(`  ✅ Done.`);
  console.log(`     Kept    : ${toKeep.length} genuine fuzzy matches (≥${FUZZY_THRESHOLD})`);
  console.log(`     Removed : ${toDelete.length} irrelevant/below-threshold posts`);
  console.log(`     Queue   : ${finalCount} items remaining`);
  console.log("================================================================\n");
}

main().catch(console.error);

