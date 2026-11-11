/**
 * QA Validation Suite: Real Public Accounts Testing (Politicians & Representatives)
 *
 * Simulates real-world social media publishing by elected representatives,
 * political leaders, and constituency volunteer chapters across platforms.
 *
 * Verifies exact caption matching, boundary edge cases, localized variations,
 * and discard accuracy for unrelated political statements.
 *
 * Run: node --no-warnings --experimental-strip-types tests/politicians_public_accounts.test.ts
 */

import {
  matchCaption,
  type MatchableCaption,
  type MatchableVariant,
  type MatchResult,
} from "../lib/matching/matcher.ts";
import { processCaption, normalizeCaption } from "../lib/matching/normalizer.ts";
import { normalizeInstagramDataset } from "../lib/collectors/instagram.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Official Campaign Content Distributed by Central Campaign Headquarters
// ─────────────────────────────────────────────────────────────────────────────

const CAMPAIGN_1_SWACHHATA =
  "स्वच्छता ही सेवा अभियान में जुड़ें! आइए अपने आसपास के क्षेत्रों को स्वच्छ और सुंदर बनाएं। #SwachhBharat #CleanIndia";

const CAMPAIGN_2_YOUTH_CONCLAVE =
  "Excited to announce the National Youth Skill Conclave 2026. Register today at https://skillsindia.org/register and be a part of India's growth story. #SkillIndia #YouthPower";

const CAMPAIGN_3_DEVELOPMENT_LONG =
  "We are committed to the all-round progress and infrastructural transformation of our state.\n\nToday, multiple road and water supply projects worth over ₹500 crore were dedicated to the citizens. These initiatives will directly empower thousands of families and provide clean tap water connections to every household.\n\nTogether, we continue to work tirelessly for a prosperous and self-reliant nation. Jai Hind!";

const CAMPAIGN_4_FESTIVAL_SHORT =
  "Warm greetings on National Youth Day! May the ideals of Swami Vivekananda inspire our youth. #YouthDay";

function makeCaptions(list: { id: string; raw: string; released_at?: string }[]): MatchableCaption[] {
  return list.map((c) => {
    const { normalized, hash } = processCaption(c.raw);
    return {
      id: c.id,
      canonical_caption: c.raw,
      normalized_caption: normalized,
      caption_hash: hash,
      released_at: c.released_at ?? null,
    };
  });
}

const ACTIVE_CAMPAIGNS: MatchableCaption[] = makeCaptions([
  { id: "camp-swachhata", raw: CAMPAIGN_1_SWACHHATA, released_at: "2026-10-01T00:00:00Z" },
  { id: "camp-youth-conclave", raw: CAMPAIGN_2_YOUTH_CONCLAVE, released_at: "2026-11-01T00:00:00Z" },
  { id: "camp-infra-long", raw: CAMPAIGN_3_DEVELOPMENT_LONG, released_at: "2026-11-05T00:00:00Z" },
  { id: "camp-youth-day", raw: CAMPAIGN_4_FESTIVAL_SHORT, released_at: "2026-11-10T00:00:00Z" },
]);

// ─────────────────────────────────────────────────────────────────────────────
// 2. Real Public Account Scraped Data (Simulated Public Scraper Payload)
// ─────────────────────────────────────────────────────────────────────────────

interface PublicPostTestCase {
  id: string;
  politicianName: string;
  handle: string;
  role: string;
  caption: string;
  expectedMatch: boolean;
  expectedTier?: "tier1_exact" | "manual_approved" | "tier2_fuzzy";
  expectedCampaignId?: string;
  expectedNeedsReview?: boolean;
  description: string;
}

const PUBLIC_POLITICIAN_POSTS: PublicPostTestCase[] = [
  // ── SCENARIO A: Verbatim Official Copy-Paste ──
  {
    id: "post-modi-01",
    politicianName: "Narendra Modi",
    handle: "narendramodi",
    role: "Prime Minister / Varanasi MP",
    caption: CAMPAIGN_1_SWACHHATA,
    expectedMatch: true,
    expectedTier: "tier1_exact",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: false,
    description: "Verbatim official caption published by verified national leadership account",
  },
  {
    id: "post-fadnavis-01",
    politicianName: "Devendra Fadnavis",
    handle: "devendra_fadnavis",
    role: "Maharashtra Dy CM",
    caption: CAMPAIGN_2_YOUTH_CONCLAVE,
    expectedMatch: true,
    expectedTier: "tier1_exact",
    expectedCampaignId: "camp-youth-conclave",
    expectedNeedsReview: false,
    description: "Exact campaign announcement with official registration link",
  },

  // ── SCENARIO B: Punctuation & Newline Formatting Differences (Handled by Tier 1C Fix) ──
  {
    id: "post-yogi-01",
    politicianName: "Yogi Adityanath",
    handle: "myogi_adityanath",
    role: "Uttar Pradesh CM",
    // Uses English period instead of Hindi Purna Viram '।', and trailing exclamation mark
    caption: "स्वच्छता ही सेवा अभियान में जुड़ें. आइए अपने आसपास के क्षेत्रों को स्वच्छ और सुंदर बनाएं! #SwachhBharat #CleanIndia",
    expectedMatch: true,
    expectedTier: "tier1_exact",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: false,
    description: "Devanagari text with punctuation substitution (Purna Viram vs Period) matches Tier 1 without review",
  },
  {
    id: "post-tharoor-01",
    politicianName: "Shashi Tharoor",
    handle: "shashitharoor",
    role: "Thiruvananthapuram MP",
    // Internal line wraps introduced by mobile drafting
    caption: "Excited to announce the National Youth Skill Conclave 2026.\nRegister today at https://skillsindia.org/register and be a part of India's growth story.\n#SkillIndia #YouthPower",
    expectedMatch: true,
    expectedTier: "tier1_exact",
    expectedCampaignId: "camp-youth-conclave",
    expectedNeedsReview: false,
    description: "Internal line wraps between sentences match Tier 1 directly",
  },

  // ── SCENARIO C: Personalized Greetings (Tier 2 Fuzzy -> Review Queue) ──
  {
    id: "post-priyanka-01",
    politicianName: "Priyanka Gandhi Vadra",
    handle: "priyankagandhivadra",
    role: "MP Wayanad",
    caption: "Namaste friends! " + CAMPAIGN_2_YOUTH_CONCLAVE,
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-youth-conclave",
    expectedNeedsReview: true,
    description: "Candidate adds personal greeting 'Namaste friends!' -> routed to review queue",
  },
  {
    id: "post-mla-delhi-01",
    politicianName: "Delhi Ward MLA Office",
    handle: "mla_delhi_central",
    role: "Constituency Representative",
    caption: "जय हिन्द साथियों! " + CAMPAIGN_1_SWACHHATA,
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: true,
    description: "Candidate adds Hindi patriotic greeting 'जय हिन्द साथियों!' -> routed to review queue",
  },

  // ── SCENARIO D: Local Constituency Hashtags & Chapter Sign-Offs ──
  {
    id: "post-varanasi-mla",
    politicianName: "Varanasi South MLA",
    handle: "mla_varanasi_south",
    role: "Local MLA",
    caption: CAMPAIGN_1_SWACHHATA + " #Varanasi #KashiVikas #Ward12 #CleanVaranasi",
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: true,
    description: "Appends local constituency hashtags -> high similarity, routed to review queue",
  },
  {
    id: "post-bjp-youth-mumbai",
    politicianName: "Youth Wing Mumbai",
    handle: "bjp_youth_mumbai",
    role: "Youth Wing Chapter",
    caption: CAMPAIGN_2_YOUTH_CONCLAVE + "\n\nFor queries contact Mumbai Central Helpline: 9876543210. Swipe up for details.",
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-youth-conclave",
    expectedNeedsReview: true,
    description: "Appends contact helpline and call-to-action suffix -> routed to review queue",
  },

  // ── SCENARIO E: Partial Excerpt from Long Press Release (Paragraph Containment) ──
  {
    id: "post-stalin-01",
    politicianName: "M.K. Stalin",
    handle: "mkstalin",
    role: "Tamil Nadu CM",
    // Quotes only paragraph 2 of the long 3-paragraph development announcement
    caption: "Vanakkam! Today, multiple road and water supply projects worth over ₹500 crore were dedicated to the citizens. These initiatives will directly empower thousands of families and provide clean tap water connections to every household. #DevelopmentFirst",
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-infra-long",
    expectedNeedsReview: true,
    description: "Quotes core paragraph from 3-paragraph press release -> captured by paragraph containment",
  },

  // ── SCENARIO F: Unrelated Routine Politician Activities (Must be DISCARDED) ──
  {
    id: "post-kejriwal-birthday",
    politicianName: "Arvind Kejriwal",
    handle: "arvindkejriwal",
    role: "AAP National Convener",
    caption: "Heartiest birthday greetings to our colleague and friend @SanjayAzadSln. Wishing you a long, healthy, and dedicated life in public service.",
    expectedMatch: false,
    description: "Routine birthday greeting to colleague -> immediately discarded (zero storage)",
  },
  {
    id: "post-rahul-condolence",
    politicianName: "Rahul Gandhi",
    handle: "rahulgandhi",
    role: "Opposition Leader / MP",
    caption: "Deeply saddened by the tragic train accident in West Bengal. My heartfelt condolences to the families who lost their loved ones. Urge our party workers to assist in rescue operations.",
    expectedMatch: false,
    description: "Condolence message and local relief appeal -> immediately discarded (zero storage)",
  },
  {
    id: "post-sitharaman-meeting",
    politicianName: "Nirmala Sitharaman",
    handle: "nsitharaman",
    role: "Union Finance Minister",
    caption: "Chaired the 55th GST Council meeting in New Delhi today. Productive discussions with state finance ministers on trade facilitation and tax rationalization.",
    expectedMatch: false,
    description: "Official ministerial meeting update -> immediately discarded (zero storage)",
  },
  {
    id: "post-smriti-personal",
    politicianName: "Smriti Irani",
    handle: "smritiiraniofficial",
    role: "Public Leader",
    caption: "Sunday morning filter coffee with good books. Recharging for a hectic week ahead! #SundayVibes #ReadingTime",
    expectedMatch: false,
    description: "Personal lifestyle / leisure post -> immediately discarded (zero storage)",
  },

  // ── SCENARIO G: Opposing / Rival Political Campaign (Similar Words, Different Intent) ──
  {
    id: "post-rival-campaign",
    politicianName: "Opposition Youth Front",
    handle: "opposition_youth_front",
    role: "Rival Political Group",
    caption: "Join our National Unemployment Protest 2026. Gather this Saturday outside the state secretariat to demand government job notifications! #YouthPower #JobsNow",
    expectedMatch: false,
    description: "Rival political rally using common hashtag #YouthPower -> strictly discarded (< threshold)",
  },

  // ── SCENARIO H: Short Slogan Disambiguation (Defense against Generic Post Match) ──
  {
    id: "post-unrelated-youth-day",
    politicianName: "Independent Local MLA",
    handle: "mla_independent_pune",
    role: "Independent MLA",
    caption: "Warm greetings to everyone on International Youth Day celebrations with college students in Pune!",
    expectedMatch: false,
    description: "Generic festival post differing from 4-word official slogan -> strict short threshold defense",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. Execution & Assertion Runner
// ─────────────────────────────────────────────────────────────────────────────

function runPoliticiansPublicAccountsTest(): void {
  console.log("════════════════════════════════════════════════════════════════════════");
  console.log("  REAL PUBLIC ACCOUNTS TESTING: POLITICIANS & REPRESENTATIVES");
  console.log("════════════════════════════════════════════════════════════════════════");

  let passed = 0;
  let failed = 0;
  const failureDetails: string[] = [];

  for (const testCase of PUBLIC_POLITICIAN_POSTS) {
    const result: MatchResult = matchCaption(testCase.caption, ACTIVE_CAMPAIGNS);

    let testPassed = true;
    let reason = "";

    if (testCase.expectedMatch) {
      if (!result.matched) {
        testPassed = false;
        reason = `Expected match (${testCase.expectedTier}), but got NOT_MATCHED (${result.reason})`;
      } else {
        if (testCase.expectedTier && result.tier !== testCase.expectedTier) {
          testPassed = false;
          reason = `Expected tier ${testCase.expectedTier}, got ${result.tier}`;
        }
        if (testCase.expectedCampaignId && result.captionId !== testCase.expectedCampaignId) {
          testPassed = false;
          reason = `Expected campaignId ${testCase.expectedCampaignId}, got ${result.captionId}`;
        }
        if (testCase.expectedNeedsReview !== undefined && result.needsReview !== testCase.expectedNeedsReview) {
          testPassed = false;
          reason = `Expected needsReview=${testCase.expectedNeedsReview}, got ${result.needsReview}`;
        }
      }
    } else {
      if (result.matched) {
        testPassed = false;
        reason = `Expected post to be DISCARDED, but it MATCHED as ${result.tier} (id=${result.captionId}, conf=${result.confidence})`;
      }
    }

    if (testPassed) {
      passed++;
      const tierLabel = result.matched ? `[${result.tier.toUpperCase()}]` : "[DISCARDED]";
      console.log(`  ✓ @${testCase.handle.padEnd(24)} ${tierLabel.padEnd(16)} ${testCase.description}`);
    } else {
      failed++;
      console.error(`  ✗ @${testCase.handle.padEnd(24)} FAILED: ${reason}`);
      failureDetails.push(`@${testCase.handle} (${testCase.politicianName}): ${reason}`);
    }
  }

  console.log("\n────────────────────────────────────────────────────────────────────────");
  console.log(`  Total Scenarios Executed : ${PUBLIC_POLITICIAN_POSTS.length}`);
  console.log(`  ✓ Passed                 : ${passed}`);
  console.log(`  ✗ Failed                 : ${failed}`);
  console.log("────────────────────────────────────────────────────────────────────────");

  // ─────────────────────────────────────────────────────────────────────────
  // 4. End-to-End Ingestion Simulation (Adapter + Ingestion Pipeline)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── Running End-to-End Scraper Ingestion Pipeline Simulation ──");

  // Convert test posts into Apify raw scraper JSON format
  const rawScrapedItems = PUBLIC_POLITICIAN_POSTS.map((p, idx) => ({
    id: `apify-post-${1000 + idx}`,
    shortCode: `CODE_${idx}`,
    type: "Image",
    url: `https://www.instagram.com/p/CODE_${idx}/`,
    caption: p.caption,
    timestamp: "2026-11-10T12:00:00.000Z",
    likesCount: 5000 + idx * 100,
    commentsCount: 200 + idx * 10,
    videoViewCount: null,
    ownerUsername: p.handle,
    ownerFullName: p.politicianName,
    ownerFollowersCount: 1000000 + idx * 50000,
    ownerFollowsCount: 150,
    ownerPostsCount: 800 + idx,
  }));

  const adapterResult = normalizeInstagramDataset(rawScrapedItems);
  assert(adapterResult.posts.length === PUBLIC_POLITICIAN_POSTS.length, "All posts parsed by adapter");
  console.log(`  ✓ Adapter parsed ${adapterResult.posts.length} scraped posts across ${adapterResult.accounts.size} politician accounts`);

  let matchedPostsCount = 0;
  let reviewQueueCount = 0;
  let discardedCount = 0;

  for (const post of adapterResult.posts) {
    const res = matchCaption(post.caption, ACTIVE_CAMPAIGNS);
    if (!res.matched) {
      discardedCount++;
    } else if (res.needsReview) {
      reviewQueueCount++;
    } else {
      matchedPostsCount++;
    }
  }

  console.log(`  ✓ Pipeline Ingestion Summary:`);
  console.log(`      - Matched Posts (Tier 1 Verified) : ${matchedPostsCount} (Auto-tracked in production)`);
  console.log(`      - Review Queue (Tier 2 Pending)   : ${reviewQueueCount} (Routed for admin approval)`);
  console.log(`      - Discarded (Zero DB Storage)     : ${discardedCount} (Non-campaign posts safely rejected)`);

  assert(matchedPostsCount === 4, `Expected 4 Tier 1 matches, got ${matchedPostsCount}`);
  assert(reviewQueueCount === 5, `Expected 5 Review Queue items, got ${reviewQueueCount}`);
  assert(discardedCount === 6, `Expected 6 Discarded posts, got ${discardedCount}`);

  console.log("  ✓ Ingestion pipeline metrics verified: 0 false positives, 0 false negatives\n");

  if (failed > 0) {
    console.error("\n  Failed Scenarios:");
    for (const d of failureDetails) {
      console.error(`  - ${d}`);
    }
    process.exit(1);
  } else {
    console.log("  ALL POLITICIAN & REPRESENTATIVE TEST SCENARIOS PASSED PERFECTLY!\n");
  }
}

runPoliticiansPublicAccountsTest();
