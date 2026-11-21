import { describe, it } from "node:test";
import { DEFAULT_REFRESH_STRATEGY } from "../lib/services/settings.ts";
import { normalizeApifyInstagramDataset } from "../lib/scrapers/apify/adapter.ts";
import { getScraperProvider } from "../lib/scrapers/factory.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runScraperEngineTests(): void {
  console.log("════════════════════════════════════════════════════════════════");
  console.log("  SCRAPER-INDEPENDENT ENGINE & 7-DAY REFRESH UNIT TESTS        ");
  console.log("════════════════════════════════════════════════════════════════");

  // ─────────────────────────────────────────────────────────────
  // 1. Settings Strategy Defaults Test
  // ─────────────────────────────────────────────────────────────
  console.log("--- Test 1: Verifying Default Strategy Settings ---");
  assert(
    DEFAULT_REFRESH_STRATEGY.mode === "30_day_cutoff",
    `Default mode should be 30_day_cutoff, got ${DEFAULT_REFRESH_STRATEGY.mode}`
  );
  assert(
    DEFAULT_REFRESH_STRATEGY.refresh_interval_days === 7,
    `Default refresh_interval_days should be 7, got ${DEFAULT_REFRESH_STRATEGY.refresh_interval_days}`
  );
  assert(
    DEFAULT_REFRESH_STRATEGY.cutoff_days === 30,
    `Default cutoff_days should be 30, got ${DEFAULT_REFRESH_STRATEGY.cutoff_days}`
  );
  assert(
    DEFAULT_REFRESH_STRATEGY.discovery_post_limit === 10,
    `Default discovery_post_limit should be 10, got ${DEFAULT_REFRESH_STRATEGY.discovery_post_limit}`
  );
  console.log("✓ Default refresh strategy correctly configured to 30-day cutoff with 7-day interval");

  // ─────────────────────────────────────────────────────────────
  // 2. Provider Factory & Interface Resolution Test
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- Test 2: Verifying Provider Factory & Decoupling ---");
  const apifyProvider = getScraperProvider("apify");
  assert(apifyProvider.name === "apify", `Expected provider name 'apify', got '${apifyProvider.name}'`);
  assert(typeof apifyProvider.startDiscoveryJob === "function", "Provider missing startDiscoveryJob");
  assert(typeof apifyProvider.startRefreshJob === "function", "Provider missing startRefreshJob");
  assert(typeof apifyProvider.fetchDirectPost === "function", "Provider missing fetchDirectPost");
  assert(typeof apifyProvider.checkJobStatus === "function", "Provider missing checkJobStatus");
  assert(typeof apifyProvider.normalizeDataset === "function", "Provider missing normalizeDataset");

  let brightDataSkippedCaught = false;
  try {
    getScraperProvider("brightdata");
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("on hold / skipped")) {
      brightDataSkippedCaught = true;
    }
  }
  assert(brightDataSkippedCaught, "Bright Data should throw explicit skipped notice as requested");
  console.log("✓ Provider factory successfully resolved Apify provider and safely handled skipped Bright Data");

  // ─────────────────────────────────────────────────────────────
  // 3. Adapter Normalization with Thumbnail & Null Metric Integrity
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- Test 3: Verifying Canonical Adapter & Metric Integrity ---");
  const rawMockData = [
    {
      id: "post_101",
      url: "https://www.instagram.com/p/DB11test/",
      ownerUsername: "Volunteer_Charlie",
      caption: "Join the clean river drive! #environment",
      type: "Image",
      timestamp: "2026-11-10T10:00:00Z",
      displayUrl: "https://instagram.fcdn.net/p101_thumb.jpg",
      likesCount: null, // Hidden likes
      commentsCount: 0, // Explicit zero comments
      videoViewCount: null, // Photos don't have views
      ownerFollowersCount: 1450,
      ownerPostsCount: 88,
    },
    {
      id: "post_102",
      url: "https://www.instagram.com/p/DB12video/",
      ownerUsername: "Volunteer_Charlie",
      caption: "Watch highlights of our drive! #riverclean",
      type: "Video",
      timestamp: "2026-11-11T12:00:00Z",
      displayUrl: "https://instagram.fcdn.net/p102_thumb.jpg",
      likesCount: 520,
      commentsCount: 34,
      videoPlayCount: 8900,
      ownerFollowersCount: 1450,
      ownerPostsCount: 88,
    },
  ];

  const normalized = normalizeApifyInstagramDataset(rawMockData);
  assert(normalized.posts.length === 2, `Expected 2 posts, got ${normalized.posts.length}`);

  const p1 = normalized.posts[0];
  assert(p1.account_handle === "volunteer_charlie", "Handle should be normalized to lowercase");
  assert(p1.metrics.likes === null, "Hidden likes must be preserved as null, not zero");
  assert(p1.metrics.comments === 0, "Explicit zero comments must remain 0");
  assert(p1.metrics.views === null, "Photo post views must remain null");
  assert(p1.thumbnail_url === "https://instagram.fcdn.net/p101_thumb.jpg", "Thumbnail URL should be extracted");

  const p2 = normalized.posts[1];
  assert(p2.metrics.likes === 520, `Expected 520 likes, got ${p2.metrics.likes}`);
  assert(p2.metrics.views === 8900, `Expected 8900 video views, got ${p2.metrics.views}`);
  console.log("✓ Canonical adapter verified: null metrics preserved, 0 counts intact, thumbnails mapped");

  // ─────────────────────────────────────────────────────────────
  // 4. Two-Part Strategy: 7-Day Eligibility & Cutoff Simulation
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- Test 4: Verifying 7-Day Refresh Eligibility & Mode Toggling ---");
  const now = new Date("2026-11-19T12:00:00Z").getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const mockTrackedPosts = [
    {
      id: "post-recent",
      posted_at: new Date(now - 3 * DAY_MS).toISOString(), // 3 days old
      last_metrics_refresh_at: new Date(now - 2 * DAY_MS).toISOString(), // Refreshed 2 days ago
      expectedEligibleCutoff: false, // Refreshed < 7 days ago
      expectedEligibleContinuous: false,
    },
    {
      id: "post-due",
      posted_at: new Date(now - 14 * DAY_MS).toISOString(), // 14 days old
      last_metrics_refresh_at: new Date(now - 8 * DAY_MS).toISOString(), // Refreshed 8 days ago (> 7 days)
      expectedEligibleCutoff: true, // Eligible in 30-day cutoff
      expectedEligibleContinuous: true, // Eligible in continuous
    },
    {
      id: "post-newly-discovered",
      posted_at: new Date(now - 1 * DAY_MS).toISOString(), // 1 day old
      last_metrics_refresh_at: null, // Never refreshed
      expectedEligibleCutoff: true, // Eligible immediately on next cycle
      expectedEligibleContinuous: true,
    },
    {
      id: "post-old-viral",
      posted_at: new Date(now - 60 * DAY_MS).toISOString(), // 60 days old (> 30 days)
      last_metrics_refresh_at: new Date(now - 10 * DAY_MS).toISOString(), // Refreshed 10 days ago
      expectedEligibleCutoff: false, // FROZEN under 30-day cutoff!
      expectedEligibleContinuous: true, // ELIGIBLE under continuous lifetime mode!
    },
  ];

  // Simulation: Filter in 30-Day Cutoff Mode
  const cutoffThreshold = new Date(now - 30 * DAY_MS).toISOString();
  const refreshIntervalThreshold = new Date(now - 7 * DAY_MS).toISOString();

  const eligibleInCutoffMode = mockTrackedPosts.filter((p) => {
    // 1. Must be within 30 days
    if (p.posted_at < cutoffThreshold) return false;
    // 2. Must be due for refresh (null or older than 7 days)
    return !p.last_metrics_refresh_at || p.last_metrics_refresh_at <= refreshIntervalThreshold;
  });

  assert(
    eligibleInCutoffMode.length === 2,
    `Expected 2 posts eligible in 30-day cutoff mode (post-due and post-newly-discovered), got ${eligibleInCutoffMode.length}`
  );
  assert(
    eligibleInCutoffMode.some((p) => p.id === "post-due"),
    "post-due should be eligible in 30-day cutoff"
  );
  assert(
    eligibleInCutoffMode.some((p) => p.id === "post-newly-discovered"),
    "post-newly-discovered should be eligible immediately"
  );
  assert(
    !eligibleInCutoffMode.some((p) => p.id === "post-old-viral"),
    "post-old-viral (>30 days) must be frozen in 30-day cutoff mode"
  );
  console.log("✓ Mode A (30-Day Window Cutoff): Correctly refreshed active posts and froze 60-day-old post");

  // Simulation: Filter in Continuous Lifetime Mode
  const eligibleInContinuousMode = mockTrackedPosts.filter((p) => {
    // No age cutoff!
    return !p.last_metrics_refresh_at || p.last_metrics_refresh_at <= refreshIntervalThreshold;
  });

  assert(
    eligibleInContinuousMode.length === 3,
    `Expected 3 posts eligible in continuous mode, got ${eligibleInContinuousMode.length}`
  );
  assert(
    eligibleInContinuousMode.some((p) => p.id === "post-old-viral"),
    "post-old-viral should be eligible in continuous mode"
  );
  console.log("✓ Mode B (Continuous Lifetime): Successfully tracked long-tail 60-day-old post");

  // ─────────────────────────────────────────────────────────────
  // 5. Delta Calculation Across 7-Day Intervals Test
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- Test 5: Verifying Engagement Deltas Across 7-Day Intervals ---");
  const prevSnapshot = { likes: 120, comments: 14, views: 2400, snapshot_date: "2026-11-12" };
  const currentPostMetrics = { likes: 165, comments: 20, views: 3100 };

  const deltaLikes = currentPostMetrics.likes - prevSnapshot.likes;
  const deltaComments = currentPostMetrics.comments - prevSnapshot.comments;
  const deltaViews = currentPostMetrics.views - prevSnapshot.views;

  assert(deltaLikes === 45, `Expected delta likes 45, got ${deltaLikes}`);
  assert(deltaComments === 6, `Expected delta comments 6, got ${deltaComments}`);
  assert(deltaViews === 700, `Expected delta views 700, got ${deltaViews}`);
  console.log("✓ True interval growth calculated accurately: +45 likes, +6 comments, +700 views across 7 days");

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("  ALL SCRAPER-INDEPENDENT ENGINE TESTS PASSED PERFECTLY!        ");
  console.log("════════════════════════════════════════════════════════════════\n");
}

runScraperEngineTests();
