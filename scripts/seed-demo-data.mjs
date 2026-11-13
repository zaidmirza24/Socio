import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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

function normalizeCaption(raw) {
  if (!raw) return "";
  let s = raw.normalize("NFKC");
  s = s.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u00AD]/g, "");
  s = s.replace(/[\u201C\u201D\u00AB\u00BB\u201E\u201F]/g, '"');
  s = s.replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'");
  s = s.replace(/[\u2013\u2014\u2015\u2212]/g, "-");
  s = s.replace(/[\u2022\u25AA\u25AB\u2023\u2043]/g, "*");
  s = s.replace(/\s*(?:\.\.\.\s*more|…\s*more|…|\.\.\.)\s*$/i, "");
  s = s.replace(/https?:\/\/[^\s]+/gi, (matchedUrl) => {
    const trimmed = matchedUrl.replace(/[.,!?:;)\]'"]+$/, "");
    const trailingPunctuation = matchedUrl.slice(trimmed.length);
    return "{{url}}" + trailingPunctuation;
  });
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[^\S\r\n]+/g, " ");
  s = s
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim()
    .toLowerCase();
  return s;
}

function computeCaptionHash(normalized) {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

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
    "account_snapshots",
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
    }
  }
}

async function seedRealData() {
  console.log("=================================================================");
  console.log("  SEEDING MONITORED PUBLIC PERSONAL & SUPPORTER ACCOUNTS         ");
  console.log("=================================================================\n");

  await cleanDatabase();

  // 1. SPECIFIED PUBLIC PERSONAL & SUPPORTER ACCOUNTS
  console.log("1. Seeding Specified Public Accounts & Followers...");
  const accountsData = [
    {
      handle: "socialistt_anuragyadav",
      volunteer_name: "Anurag Yadav",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 124000,
      following: 480,
      post_count: 890,
    },
    {
      handle: "youthwithakhilesh",
      volunteer_name: "Youth with Akhilesh",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 340000,
      following: 120,
      post_count: 1450,
    },
    {
      handle: "cyclewithakhilesh",
      volunteer_name: "Cycle with Akhilesh",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 185000,
      following: 85,
      post_count: 1120,
    },
    {
      handle: "sp_pravind",
      volunteer_name: "Pravind Yadav",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 68000,
      following: 320,
      post_count: 640,
    },
    {
      handle: "monuahir.100",
      volunteer_name: "Monu Ahir",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 45000,
      following: 260,
      post_count: 510,
    },
    {
      handle: "yadav_aman_official_",
      volunteer_name: "Aman Yadav",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 52000,
      following: 340,
      post_count: 420,
    },
    {
      handle: "shivamkashyapsp",
      volunteer_name: "Shivam Kashyap",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 38000,
      following: 290,
      post_count: 380,
    },
    {
      handle: "yadav_pranshul",
      volunteer_name: "Pranshul Yadav",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 61000,
      following: 410,
      post_count: 560,
    },
    {
      handle: "saurabh.anand91",
      volunteer_name: "Saurabh Anand",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 29000,
      following: 180,
      post_count: 290,
    },
    {
      handle: "lokbandhulive1",
      volunteer_name: "Lokbandhu Live",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 95000,
      following: 150,
      post_count: 820,
    },
    {
      handle: "samajwadi_lucknow",
      volunteer_name: "Samajwadi Lucknow",
      platform: "instagram",
      status: "active",
      is_visible: true,
      followers: 110000,
      following: 220,
      post_count: 980,
    },
  ];

  const accountsMap = new Map();

  for (const acc of accountsData) {
    const { data, error } = await supabase
      .from("accounts")
      .upsert(
        {
          handle: acc.handle,
          volunteer_name: acc.volunteer_name,
          platform: acc.platform,
          status: acc.status,
          is_visible: acc.is_visible,
          last_checked_at: new Date().toISOString(),
        },
        { onConflict: "platform,handle" }
      )
      .select()
      .single();

    if (error) {
      console.error(`Failed to insert account @${acc.handle}:`, error.message);
      return;
    }

    accountsMap.set(acc.handle, {
      ...data,
      followers: acc.followers,
      following: acc.following,
      post_count: acc.post_count,
    });

    // 4-day follower history
    for (let dayOffset = 3; dayOffset >= 0; dayOffset--) {
      const d = new Date();
      d.setDate(d.getDate() - dayOffset);
      const dateStr = d.toISOString().split("T")[0];
      const drift = (3 - dayOffset) * Math.round(acc.followers * 0.003);

      await supabase.from("account_snapshots").upsert(
        {
          account_id: data.id,
          snapshot_date: dateStr,
          followers: acc.followers - (Math.round(acc.followers * 0.01) - drift),
          following: acc.following,
          post_count: acc.post_count - (dayOffset > 0 ? 1 : 0),
        },
        { onConflict: "account_id,snapshot_date" }
      );
    }
  }
  console.log(`✓ Inserted ${accountsMap.size} public personal & supporter accounts.`);

  // 2. OFFICIAL CAMPAIGN CAPTIONS
  console.log("\n2. Seeding Official Campaign Captions...");
  const rawCampaigns = [
    {
      title: "Jan Samvad & Samajik Nyay Campaign",
      released_days_ago: 3,
      canonical:
        "सामाजिक न्याय और युवाओं के उज्ज्वल भविष्य के लिए हम सब साथ मिलकर आगे बढ़ेंगे। #Samajwadi #YuvaShakti #JanSamvad",
    },
    {
      title: "Vikas & Rozgar Youth Rally 2026",
      released_days_ago: 4,
      canonical:
        "Excited to announce the Rozgar & Vikas Youth Initiative 2026. Register today at https://rozgaryuva.org/register and join the movement for progress and youth empowerment. #RozgarFirst #YouthPower",
    },
    {
      title: "Kisan & Gramin Vikas Abhiyan",
      released_days_ago: 3,
      canonical:
        "हम सभी किसानों, मज़दूरों और युवाओं की खुशहाली और अधिकार के लिए पूरी निष्ठा के साथ काम करने के लिए संकल्पित हैं। जय हिन्द!",
    },
  ];

  const campaignMap = new Map();

  for (const c of rawCampaigns) {
    const normalized = normalizeCaption(c.canonical);
    const hash = computeCaptionHash(normalized);
    const releaseDate = new Date();
    releaseDate.setDate(releaseDate.getDate() - c.released_days_ago);

    const { data, error } = await supabase
      .from("campaign_captions")
      .upsert(
        {
          title: c.title,
          canonical_caption: c.canonical,
          normalized_caption: normalized,
          caption_hash: hash,
          released_at: releaseDate.toISOString(),
          status: "active",
        },
        { onConflict: "caption_hash" }
      )
      .select()
      .single();

    if (error) {
      console.error(`Failed to insert campaign "${c.title}":`, error.message);
      return;
    }
    campaignMap.set(c.title, data);
  }
  console.log(`✓ Inserted ${campaignMap.size} official campaign captions.`);

  // 3. MATCHED POSTS
  console.log("\n3. Seeding Matched Posts with Engagement...");
  const camp1 = campaignMap.get("Jan Samvad & Samajik Nyay Campaign");
  const camp2 = campaignMap.get("Vikas & Rozgar Youth Rally 2026");
  const camp3 = campaignMap.get("Kisan & Gramin Vikas Abhiyan");

  const realMatchedPosts = [
    {
      campaign: camp1,
      account: accountsMap.get("socialistt_anuragyadav"),
      postId: "4027108254485064479",
      shortCode: "DfjKZ70oCsf",
      url: "https://www.instagram.com/p/DfjKZ70oCsf/",
      postedAt: "2026-11-10T05:32:15.000Z",
      mediaType: "carousel",
      liveLikes: 8420,
      liveComments: 312,
      liveViews: 65000,
      history: [
        { dayOffset: 2, likes: 3800, comments: 140, views: 28000, dL: 3800, dC: 140, dV: 28000 },
        { dayOffset: 1, likes: 6700, comments: 245, views: 49000, dL: 2900, dC: 105, dV: 21000 },
        { dayOffset: 0, likes: 8420, comments: 312, views: 65000, dL: 1720, dC: 67, dV: 16000 },
      ],
    },
    {
      campaign: camp2,
      account: accountsMap.get("youthwithakhilesh"),
      postId: "4025800000000000001",
      shortCode: "DfeotvlmiHk",
      url: "https://www.instagram.com/p/DfeotvlmiHk/",
      postedAt: "2026-11-08T11:20:54.000Z",
      mediaType: "photo",
      liveLikes: 14500,
      liveComments: 580,
      liveViews: 112000,
      history: [
        { dayOffset: 3, likes: 5800, comments: 210, views: 42000, dL: 5800, dC: 210, dV: 42000 },
        { dayOffset: 2, likes: 9800, comments: 390, views: 76000, dL: 4000, dC: 180, dV: 34000 },
        { dayOffset: 1, likes: 12800, comments: 505, views: 98000, dL: 3000, dC: 115, dV: 22000 },
        { dayOffset: 0, likes: 14500, comments: 580, views: 112000, dL: 1700, dC: 75, dV: 14000 },
      ],
    },
    {
      campaign: camp2,
      account: accountsMap.get("cyclewithakhilesh"),
      postId: "4026600000000000002",
      shortCode: "DfhnDkVALTi",
      url: "https://www.instagram.com/p/DfhnDkVALTi/",
      postedAt: "2026-11-09T15:08:12.000Z",
      mediaType: "video",
      liveLikes: 9840,
      liveComments: 365,
      liveViews: 88000,
      history: [
        { dayOffset: 2, likes: 4500, comments: 160, views: 39000, dL: 4500, dC: 160, dV: 39000 },
        { dayOffset: 1, likes: 7800, comments: 285, views: 69000, dL: 3300, dC: 125, dV: 30000 },
        { dayOffset: 0, likes: 9840, comments: 365, views: 88000, dL: 2040, dC: 80, dV: 19000 },
      ],
    },
    {
      campaign: camp3,
      account: accountsMap.get("sp_pravind"),
      postId: "4027748889893071307",
      shortCode: "DflcEaCjOnL",
      url: "https://www.instagram.com/p/DflcEaCjOnL/",
      postedAt: "2026-11-11T02:45:05.000Z",
      mediaType: "carousel",
      liveLikes: 4320,
      liveComments: 185,
      liveViews: 34000,
      history: [
        { dayOffset: 0, likes: 4320, comments: 185, views: 34000, dL: 4320, dC: 185, dV: 34000 },
      ],
    },
    {
      campaign: camp1,
      account: accountsMap.get("yadav_aman_official_"),
      postId: "4027750000000000008",
      shortCode: "Dfm89aBcdEf",
      url: "https://www.instagram.com/p/Dfm89aBcdEf/",
      postedAt: "2026-11-11T04:15:00.000Z",
      mediaType: "photo",
      liveLikes: 3890,
      liveComments: 142,
      liveViews: 28000,
      history: [
        { dayOffset: 0, likes: 3890, comments: 142, views: 28000, dL: 3890, dC: 142, dV: 28000 },
      ],
    },
  ];

  let totalSnapshots = 0;

  for (const p of realMatchedPosts) {
    // 3a. matched_posts
    const { data: matchedPost, error: mErr } = await supabase
      .from("matched_posts")
      .upsert(
        {
          caption_id: p.campaign.id,
          account_id: p.account.id,
          platform: "instagram",
          platform_post_id: p.postId,
          post_url: p.url,
          normalized_caption: p.campaign.normalized_caption,
          match_tier: "tier1_exact",
          match_confidence: 1.0,
          tracking_status: "tracking",
          posted_at: p.postedAt,
          first_seen_at: p.postedAt,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "platform,platform_post_id" }
      )
      .select()
      .single();

    if (mErr) {
      console.error(`Failed to insert matched_post ${p.postId}:`, mErr.message);
      continue;
    }

    // 3b. legacy posts for Analytics
    const { data: legacyPost } = await supabase
      .from("posts")
      .upsert(
        {
          account_id: p.account.id,
          platform: "instagram",
          platform_post_id: p.postId,
          url: p.url,
          caption: p.campaign.canonical_caption,
          media_type: p.mediaType,
          posted_at: p.postedAt,
          first_seen_at: p.postedAt,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "platform,platform_post_id" }
      )
      .select()
      .single();

    // 3c. historical engagement snapshots
    for (const snap of p.history) {
      const snapDate = new Date();
      snapDate.setDate(snapDate.getDate() - snap.dayOffset);
      const snapDateStr = snapDate.toISOString().split("T")[0];

      await supabase.from("metric_snapshots").upsert(
        {
          post_id: matchedPost.id,
          snapshot_date: snapDateStr,
          likes: snap.likes,
          comments: snap.comments,
          views: snap.views,
          delta_likes: snap.dL,
          delta_comments: snap.dC,
          delta_views: snap.dV,
          source: "daily_batch",
          fetched_at: snapDate.toISOString(),
        },
        { onConflict: "post_id,snapshot_date" }
      );

      if (legacyPost) {
        await supabase.from("post_snapshots").upsert(
          {
            post_id: legacyPost.id,
            snapshot_date: snapDateStr,
            likes: snap.likes,
            comments: snap.comments,
            views: snap.views,
            shares: Math.round(snap.comments * 1.5),
          },
          { onConflict: "post_id,snapshot_date" }
        );
      }
      totalSnapshots++;
    }
  }
  console.log(`✓ Inserted ${realMatchedPosts.length} matched public posts and ${totalSnapshots} engagement snapshots.`);

  // 4. REVIEW QUEUE POSTS
  console.log("\n4. Seeding Review Queue Posts...");

  const reviewItems = [
    {
      caption: camp2,
      account: accountsMap.get("monuahir.100"),
      postId: "4027227526648056815",
      url: "https://www.instagram.com/p/DfjlhkriEvv/",
      similarity: 0.935,
      candidateText:
        "Excited to announce the Rozgar & Vikas Youth Initiative 2026. Register today at https://rozgaryuva.org/register and join the movement for progress and youth empowerment. सभी साथी जुड़ें और आवाज़ बुलंद करें! #RozgarFirst #YouthPower #YuvaEkta",
    },
    {
      caption: camp1,
      account: accountsMap.get("shivamkashyapsp"),
      postId: "4026300000000000004",
      url: "https://www.instagram.com/p/DfhW7rilFKb/",
      similarity: 0.925,
      candidateText:
        "जय हिन्द साथियों! सामाजिक न्याय और युवाओं के उज्ज्वल भविष्य के लिए हम सब साथ मिलकर आगे बढ़ेंगे। #Samajwadi #YuvaShakti #JanSamvad #SamajwadiParty",
    },
  ];

  for (const item of reviewItems) {
    const { error } = await supabase.from("review_queue").upsert(
      {
        caption_id: item.caption.id,
        account_id: item.account.id,
        platform: "instagram",
        platform_post_id: item.postId,
        post_url: item.url,
        candidate_caption: item.candidateText,
        similarity_score: item.similarity,
        status: "pending",
        created_at: new Date().toISOString(),
      },
      { onConflict: "platform,platform_post_id" }
    );

    if (error) {
      console.error(`Failed to insert review item:`, error.message);
    }
  }
  console.log(`✓ Inserted ${reviewItems.length} review queue items.`);

  // 5. AUDIT LOGS FOR HEALTH PAGE
  console.log("\n5. Seeding Ingestion Audit Runs for System Health Page...");

  for (let i = 3; i >= 0; i--) {
    const runDate = new Date();
    runDate.setDate(runDate.getDate() - i);
    runDate.setHours(8, 0, 0, 0);
    const compDate = new Date(runDate.getTime() + 48000);

    await supabase.from("collection_runs").insert({
      actor_run_id: `apify-run-live-${202400 + i}`,
      platform: "instagram",
      started_at: runDate.toISOString(),
      completed_at: compDate.toISOString(),
      status: "success",
      accounts_targeted: accountsData.length,
      posts_found: accountsData.length + (3 - i) * 2,
      posts_upserted: accountsData.length + (3 - i) * 2,
      snapshots_created: accountsData.length + (3 - i) * 2,
      error: null,
    });
  }
  console.log("✓ Inserted 4 successful daily collection runs in audit log.");

  console.log("\n=================================================================");
  console.log("  ALL MONITORED ACCOUNTS DATA SEEDING COMPLETE!                  ");
  console.log("=================================================================");
}

seedRealData();
