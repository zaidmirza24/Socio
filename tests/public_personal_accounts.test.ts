/**
 * QA Validation Suite: Real Public Personal Accounts Testing (Volunteers & Youth Ambassadors)
 *
 * Simulates real-world social media publishing by public personal accounts:
 * community volunteers, student leads, campus ambassadors, and grassroots creators.
 *
 * Verifies exact caption matching, boundary edge cases, localized variations,
 * and discard accuracy for unrelated personal lifestyle/social posts.
 *
 * Run: node --no-warnings --experimental-strip-types tests/public_personal_accounts.test.ts
 */

import {
  matchCaption,
  type MatchableCaption,
  type MatchResult,
} from "../lib/matching/matcher.ts";
import { processCaption } from "../lib/matching/normalizer.ts";
import { normalizeInstagramDataset } from "../lib/collectors/instagram.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Official Campaign Content Distributed to Volunteer Chapters
// ─────────────────────────────────────────────────────────────────────────────

const CAMPAIGN_1_SWACHHATA =
  "स्वच्छता ही सेवा अभियान में जुड़ें! आइए अपने आसपास के क्षेत्रों को स्वच्छ और सुंदर बनाएं। #SwachhBharat #CleanIndia #YouthVolunteers";

const CAMPAIGN_2_YOUTH_CONCLAVE =
  "Excited to announce the National Youth Skill Conclave 2026. Register today at https://skillsindia.org/register and be a part of India's growth story. #SkillIndia #YouthPower";

const CAMPAIGN_3_DEVELOPMENT_LONG =
  "We are committed to the all-round progress and infrastructural transformation of our local community.\n\nToday, multiple road and water supply projects worth over ₹500 crore were dedicated to the citizens. These initiatives will directly empower thousands of families and provide clean tap water connections to every household.\n\nTogether, we continue to work tirelessly for a prosperous and self-reliant nation. Jai Hind!";

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
// 2. Real Public Personal Account Scraped Data (Simulated Public Scraper Payload)
// ─────────────────────────────────────────────────────────────────────────────

interface PublicPersonalPostTestCase {
  id: string;
  volunteerName: string;
  handle: string;
  role: string;
  caption: string;
  expectedMatch: boolean;
  expectedTier?: "tier1_exact" | "manual_approved" | "tier2_fuzzy";
  expectedCampaignId?: string;
  expectedNeedsReview?: boolean;
  description: string;
}

const PUBLIC_PERSONAL_POSTS: PublicPersonalPostTestCase[] = [
  // ── SCENARIO A: Verbatim Campaign Copy-Paste by Volunteers ──
  {
    id: "post-aman-01",
    volunteerName: "Aman Yadav",
    handle: "yadav_aman_official_",
    role: "Youth Volunteer",
    caption: CAMPAIGN_1_SWACHHATA,
    expectedMatch: true,
    expectedTier: "tier1_exact",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: false,
    description: "Verbatim official caption published by active volunteer",
  },
  {
    id: "post-shivam-01",
    volunteerName: "Shivam Kashyap",
    handle: "shivamkashyapsp",
    role: "Campaign Coordinator",
    caption: CAMPAIGN_2_YOUTH_CONCLAVE,
    expectedMatch: true,
    expectedTier: "tier1_exact",
    expectedCampaignId: "camp-youth-conclave",
    expectedNeedsReview: false,
    description: "Exact campaign announcement with official registration link",
  },

  // ── SCENARIO B: Punctuation & Newline Formatting Differences ──
  {
    id: "post-pranshul-01",
    volunteerName: "Pranshul Yadav",
    handle: "yadav_pranshul",
    role: "Youth Outreach Lead",
    // Uses English period instead of Hindi Purna Viram '।', and trailing exclamation mark
    caption: "स्वच्छता ही सेवा अभियान में जुड़ें. आइए अपने आसपास के क्षेत्रों को स्वच्छ और सुंदर बनाएं! #SwachhBharat #CleanIndia #YouthVolunteers",
    expectedMatch: true,
    expectedTier: "tier1_exact",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: false,
    description: "Devanagari text with punctuation substitution (Purna Viram vs Period) matches Tier 1 without review",
  },
  {
    id: "post-saurabh-01",
    volunteerName: "Saurabh Anand",
    handle: "saurabh.anand91",
    role: "Student Coordinator",
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
    id: "post-lokbandhu-01",
    volunteerName: "Lokbandhu Live",
    handle: "lokbandhulive1",
    role: "Community Media Account",
    caption: "Namaste friends! " + CAMPAIGN_2_YOUTH_CONCLAVE,
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-youth-conclave",
    expectedNeedsReview: true,
    description: "Volunteer adds personal greeting 'Namaste friends!' -> routed to review queue",
  },
  {
    id: "post-samajwadi-lucknow-01",
    volunteerName: "Samajwadi Lucknow",
    handle: "samajwadi_lucknow",
    role: "City Chapter Volunteer",
    caption: "जय हिन्द साथियों! " + CAMPAIGN_1_SWACHHATA,
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: true,
    description: "Volunteer adds Hindi greeting 'जय हिन्द साथियों!' -> routed to review queue",
  },

  // ── SCENARIO D: Local College / City Chapter Hashtags ──
  {
    id: "post-pune-chapter",
    volunteerName: "Tanvi Deshmukh",
    handle: "tanvi_deshmukh_pune",
    role: "Pune Youth Lead",
    caption: CAMPAIGN_1_SWACHHATA + " #PuneVolunteers #CleanPune #FergussonCollege #YouthAction",
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-swachhata",
    expectedNeedsReview: true,
    description: "Appends local campus & city hashtags -> high similarity, routed to review queue",
  },
  {
    id: "post-delhi-coordinator",
    volunteerName: "Sameer Khan",
    handle: "sameerkhan_social",
    role: "Delhi University Coordinator",
    caption: CAMPAIGN_2_YOUTH_CONCLAVE + "\n\nFor queries contact North Campus Helpline: 9876543210. DM me for registration help!",
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-youth-conclave",
    expectedNeedsReview: true,
    description: "Appends student helpline and DM call-to-action suffix -> routed to review queue",
  },

  // ── SCENARIO E: Partial Excerpt from Long Press Release (Paragraph Containment) ──
  {
    id: "post-meera-01",
    volunteerName: "Meera Nair",
    handle: "meera_nair_v",
    role: "State Youth Lead",
    // Quotes paragraph 2 of the long development announcement
    caption: "Vanakkam! Today, multiple road and water supply projects worth over ₹500 crore were dedicated to the citizens. These initiatives will directly empower thousands of families and provide clean tap water connections to every household. #DevelopmentFirst",
    expectedMatch: true,
    expectedTier: "tier2_fuzzy",
    expectedCampaignId: "camp-infra-long",
    expectedNeedsReview: true,
    description: "Quotes core paragraph from 3-paragraph press release -> captured by paragraph containment",
  },

  // ── SCENARIO F: Unrelated Routine Personal Lifestyle Posts (Must be DISCARDED) ──
  {
    id: "post-birthday-personal",
    volunteerName: "Kunal Joshi",
    handle: "kunal_joshi_99",
    role: "Volunteer Member",
    caption: "Heartiest birthday greetings to my best friend @AdityaK! Wishing you another incredible year of adventures and fun memories ahead.",
    expectedMatch: false,
    description: "Personal friend birthday greeting -> immediately discarded (zero storage)",
  },
  {
    id: "post-exam-update",
    volunteerName: "Riya Sen",
    handle: "riyasen_studies",
    role: "Student Member",
    caption: "Finally done with semester final exams! Time to relax, read novels, and catch up on sleep this week. #SemesterDone #CollegeLife",
    expectedMatch: false,
    description: "College exam study update -> immediately discarded (zero storage)",
  },
  {
    id: "post-coffee-lifestyle",
    volunteerName: "Aditi Rao",
    handle: "aditirao_clicks",
    role: "Photography Volunteer",
    caption: "Sunday morning filter coffee with good books. Recharging for a hectic week ahead! #SundayVibes #ReadingTime #CoffeeLover",
    expectedMatch: false,
    description: "Personal lifestyle / coffee photo -> immediately discarded (zero storage)",
  },
  {
    id: "post-travel-vlog",
    volunteerName: "Nikhil Gupta",
    handle: "nikhil_treks",
    role: "Adventure Volunteer",
    caption: "Sunrise at Triund trek today! The Himalayas never fail to amaze me. Truly blessed to witness this view. #HikingLife #HimachalPradesh",
    expectedMatch: false,
    description: "Personal travel and hiking post -> immediately discarded (zero storage)",
  },

  // ── SCENARIO G: Unrelated Social Rally (Similar Hashtags, Different Content) ──
  {
    id: "post-commercial-contest",
    volunteerName: "Campus Fest Page",
    handle: "campus_fest_2026",
    role: "Unrelated Account",
    caption: "Join our National College Dance Competition 2026. Register now to win exciting cash prizes and trophies! #YouthPower #DanceFest",
    expectedMatch: false,
    description: "Commercial fest competition using #YouthPower hashtag -> strictly discarded (< threshold)",
  },

  // ── SCENARIO H: Short Slogan Disambiguation (Defense against Generic Post Match) ──
  {
    id: "post-unrelated-festival-greeting",
    volunteerName: "Deepak Rawat",
    handle: "deepak_rawat_daily",
    role: "Personal Account",
    caption: "Warm greetings to everyone on International Youth Day celebrations with college friends in Pune!",
    expectedMatch: false,
    description: "Generic festival greeting differing from 4-word official slogan -> strict short threshold defense",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. Execution & Assertion Runner
// ─────────────────────────────────────────────────────────────────────────────

export function runPublicPersonalAccountsTest(): void {
  console.log("════════════════════════════════════════════════════════════════════════");
  console.log("  REAL PUBLIC PERSONAL ACCOUNTS TESTING (VOLUNTEERS & AMBASSADORS)      ");
  console.log("════════════════════════════════════════════════════════════════════════");

  let passed = 0;
  let failed = 0;
  const failureDetails: string[] = [];

  for (const testCase of PUBLIC_PERSONAL_POSTS) {
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
      failureDetails.push(`@${testCase.handle} (${testCase.volunteerName}): ${reason}`);
    }
  }

  console.log("\n────────────────────────────────────────────────────────────────────────");
  console.log(`  Total Scenarios Executed : ${PUBLIC_PERSONAL_POSTS.length}`);
  console.log(`  ✓ Passed                 : ${passed}`);
  console.log(`  ✗ Failed                 : ${failed}`);
  console.log("────────────────────────────────────────────────────────────────────────");

  // ─────────────────────────────────────────────────────────────────────────
  // 4. End-to-End Ingestion Simulation (Adapter + Ingestion Pipeline)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n── Running End-to-End Scraper Ingestion Pipeline Simulation ──");

  // Convert test posts into Apify raw scraper JSON format
  const rawScrapedItems = PUBLIC_PERSONAL_POSTS.map((p, idx) => ({
    id: `apify-post-${1000 + idx}`,
    shortCode: `CODE_${idx}`,
    type: "Image",
    url: `https://www.instagram.com/p/CODE_${idx}/`,
    caption: p.caption,
    timestamp: "2026-11-10T12:00:00.000Z",
    likesCount: 150 + idx * 30,
    commentsCount: 15 + idx * 2,
    videoViewCount: null,
    ownerUsername: p.handle,
    ownerFullName: p.volunteerName,
    ownerFollowersCount: 5000 + idx * 400,
    ownerFollowsCount: 350,
    ownerPostsCount: 120 + idx,
  }));

  const adapterResult = normalizeInstagramDataset(rawScrapedItems);
  assert(adapterResult.posts.length === PUBLIC_PERSONAL_POSTS.length, "All posts parsed by adapter");
  console.log(`  ✓ Adapter parsed ${adapterResult.posts.length} scraped posts across ${adapterResult.accounts.size} public personal accounts`);

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
    console.log("  ALL PUBLIC PERSONAL ACCOUNT TEST SCENARIOS PASSED PERFECTLY!\n");
  }
}

runPublicPersonalAccountsTest();

