/**
 * QA Integration Test Suite: Complete Matching Workflow
 *
 * Verifies the end-to-end flow from raw Instagram scraped items through
 * normalization, caption matching, review queue routing, and metric snapshotting
 * using an isolated mock database environment.
 *
 * Ensures ZERO modification to production data.
 * Run: node --no-warnings --experimental-strip-types tests/matching_workflow_integration.test.ts
 */

import { normalizeInstagramDataset } from "../lib/collectors/instagram.ts";
import {
  matchCaption,
  type MatchableCaption,
  type MatchableVariant,
  type MatchResult,
} from "../lib/matching/matcher.ts";
import { processCaption } from "../lib/matching/normalizer.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

interface MockDB {
  accounts: Map<string, { id: string; handle: string; is_visible: boolean }>;
  campaign_captions: Map<string, MatchableCaption & { title: string; status: string }>;
  caption_approved_variants: Map<string, { caption_id: string; variant_hash: string }>;
  review_queue: Map<string, {
    caption_id: string;
    account_id: string;
    platform: string;
    platform_post_id: string;
    post_url: string;
    candidate_caption: string;
    similarity_score: number;
    status: "pending" | "approved" | "rejected";
  }>;
  matched_posts: Map<string, {
    id: string;
    caption_id: string;
    account_id: string;
    platform: string;
    platform_post_id: string;
    match_tier: string;
    match_confidence: number;
  }>;
  metric_snapshots: Array<{
    post_id: string;
    snapshot_date: string;
    likes: number | null;
    comments: number | null;
    views: number | null;
  }>;
}

function createMockDB(): MockDB {
  return {
    accounts: new Map(),
    campaign_captions: new Map(),
    caption_approved_variants: new Map(),
    review_queue: new Map(),
    matched_posts: new Map(),
    metric_snapshots: [],
  };
}

/**
 * Isolated end-to-end ingestion runner mimicking lib/services/ingestion.ts
 * without touching external Supabase network or database.
 */
function runIsolatedIngestion(
  db: MockDB,
  rawScrapedItems: unknown[],
  targetDate: string = "2026-11-11"
) {
  // 1. Adapter layer: normalize Apify items
  const adapterResult = normalizeInstagramDataset(rawScrapedItems);

  // 2. Load active captions from DB
  const activeCaptions: MatchableCaption[] = Array.from(db.campaign_captions.values())
    .filter((c) => c.status === "active")
    .map((c) => ({
      id: c.id,
      caption_hash: c.caption_hash,
      canonical_caption: c.canonical_caption,
      normalized_caption: c.normalized_caption,
      released_at: c.released_at,
    }));

  const approvedVariants: MatchableVariant[] = Array.from(db.caption_approved_variants.values()).map(
    (v) => ({
      caption_id: v.caption_id,
      variant_hash: v.variant_hash,
    })
  );

  let postsMatched = 0;
  let postsDiscarded = 0;
  let reviewsQueued = 0;

  for (const post of adapterResult.posts) {
    const account = db.accounts.get(post.account_handle);
    if (!account) {
      // Unmonitored account -> skip
      continue;
    }

    const matchResult = matchCaption(post.caption, activeCaptions, approvedVariants, {
      postedAt: post.posted_at,
    });

    const postKey = `${post.platform}:${post.platform_post_id}`;

    if (!matchResult.matched) {
      postsDiscarded++;
      continue;
    }

    if (matchResult.needsReview) {
      const existingReview = db.review_queue.get(postKey);
      if (existingReview?.status === "rejected") {
        postsDiscarded++;
        continue;
      }
      if (existingReview?.status === "approved") {
        continue;
      }

      db.review_queue.set(postKey, {
        caption_id: matchResult.captionId,
        account_id: account.id,
        platform: post.platform,
        platform_post_id: post.platform_post_id,
        post_url: post.url,
        candidate_caption: post.caption ?? "",
        similarity_score: matchResult.confidence,
        status: "pending",
      });
      reviewsQueued++;
      continue;
    }

    // Tier 1 Exact or Approved Variant
    const matchedPostId = `matched-${post.platform_post_id}`;
    db.matched_posts.set(postKey, {
      id: matchedPostId,
      caption_id: matchResult.captionId,
      account_id: account.id,
      platform: post.platform,
      platform_post_id: post.platform_post_id,
      match_tier: matchResult.tier,
      match_confidence: matchResult.confidence,
    });
    postsMatched++;

    db.metric_snapshots.push({
      post_id: matchedPostId,
      snapshot_date: targetDate,
      likes: post.metrics.likes,
      comments: post.metrics.comments,
      views: post.metrics.views,
    });
  }

  return { postsMatched, postsDiscarded, reviewsQueued };
}

function runIntegrationTests(): void {
  console.log("--- Starting Matching Workflow Integration Tests (Isolated Mock DB) ---");

  // Setup initial mock DB
  const db = createMockDB();

  // Register accounts
  db.accounts.set("volunteer_alice", { id: "acc-1", handle: "volunteer_alice", is_visible: true });
  db.accounts.set("volunteer_bob", { id: "acc-2", handle: "volunteer_bob", is_visible: true });
  db.accounts.set("volunteer_carol", { id: "acc-3", handle: "volunteer_carol", is_visible: true });

  // Register campaign caption
  const officialCaption = "Join us this Sunday for our Annual Tree Planting Drive! Bring gloves and water bottles.";
  const { normalized, hash } = processCaption(officialCaption);
  db.campaign_captions.set("cap-tree", {
    id: "cap-tree",
    title: "Tree Planting Drive",
    canonical_caption: officialCaption,
    normalized_caption: normalized,
    caption_hash: hash,
    status: "active",
    released_at: "2026-11-01T00:00:00Z",
  });

  // TEST 1: Exact match post flow
  const rawItem1 = {
    id: "post-101",
    url: "https://instagram.com/p/post101",
    caption: "   Join us this Sunday for our Annual Tree Planting Drive! Bring gloves and water bottles.   ",
    ownerUsername: "volunteer_alice",
    timestamp: "2026-11-10T10:00:00Z",
    likesCount: 45,
    commentsCount: 3,
  };

  const res1 = runIsolatedIngestion(db, [rawItem1]);
  assert(res1.postsMatched === 1, `Test 1 failed: Expected 1 post matched, got ${res1.postsMatched}`);
  assert(db.matched_posts.has("instagram:post-101"), "Matched posts should contain post-101");
  assert(db.metric_snapshots.length === 1, "Should have created 1 metric snapshot");
  console.log("✓ INT-01: Raw scraped post with exact caption -> matched_posts & metric_snapshots created");

  // TEST 2: Unrelated personal post flow (Zero DB storage)
  const rawItem2 = {
    id: "post-102",
    url: "https://instagram.com/p/post102",
    caption: "Sunday brunch with friends! Best avocado toast ever #weekend",
    ownerUsername: "volunteer_alice",
    timestamp: "2026-11-10T12:00:00Z",
    likesCount: 120,
    commentsCount: 15,
  };

  const initialMatchedCount = db.matched_posts.size;
  const initialReviewCount = db.review_queue.size;
  const res2 = runIsolatedIngestion(db, [rawItem2]);
  assert(res2.postsDiscarded === 1, "Unrelated post must be discarded");
  assert(db.matched_posts.size === initialMatchedCount, "Zero matched_posts created for unrelated post");
  assert(db.review_queue.size === initialReviewCount, "Zero review_queue rows created for unrelated post");
  console.log("✓ INT-02: Unrelated personal post -> immediately discarded (zero DB records)");

  // TEST 3: Typo/Fuzzy match post flow -> routes to review_queue
  const rawItem3 = {
    id: "post-103",
    url: "https://instagram.com/p/post103",
    caption: "Join us this Sunday for our Annual Tree Planting Drive! Bring glove and water bottle.",
    ownerUsername: "volunteer_bob",
    timestamp: "2026-11-10T14:00:00Z",
    likesCount: 22,
    commentsCount: 1,
  };

  const res3 = runIsolatedIngestion(db, [rawItem3]);
  assert(res3.reviewsQueued === 1, "Fuzzy post must be queued for review");
  assert(db.review_queue.has("instagram:post-103"), "Review queue must contain post-103");
  const queuedItem = db.review_queue.get("instagram:post-103")!;
  assert(queuedItem.status === "pending", "Status must be pending");
  assert(queuedItem.caption_id === "cap-tree", "Caption ID must match");
  console.log("✓ INT-03: Post with typo -> routed to review_queue with pending status");

  // TEST 4: Idempotency — Rerunning same items produces zero duplicates
  const res4 = runIsolatedIngestion(db, [rawItem1, rawItem2, rawItem3]);
  // post-101 was already matched; upsert updates it, does not duplicate
  assert(db.matched_posts.size === 1, "matched_posts count must not increase on duplicate run");
  assert(db.review_queue.size === 1, "review_queue count must not increase on duplicate run");
  console.log("✓ INT-04: Idempotency verified — duplicate runs do not inflate counts");

  // TEST 5: State Machine — Rejected review items remain discarded on subsequent ingestions
  db.review_queue.get("instagram:post-103")!.status = "rejected";
  const res5 = runIsolatedIngestion(db, [rawItem3]);
  assert(res5.postsDiscarded === 1, "Previously rejected post must be discarded on subsequent scrape");
  assert(db.review_queue.get("instagram:post-103")!.status === "rejected", "Status must remain rejected");
  console.log("✓ INT-05: Review rejection state guard — rejected post never resurrected to pending");

  // TEST 6: Multi-volunteer same caption
  const rawItemBob = {
    id: "post-104",
    url: "https://instagram.com/p/post104",
    caption: officialCaption,
    ownerUsername: "volunteer_bob",
    timestamp: "2026-11-10T15:00:00Z",
    likesCount: 30,
    commentsCount: 2,
  };
  const rawItemCarol = {
    id: "post-105",
    url: "https://instagram.com/p/post105",
    caption: officialCaption,
    ownerUsername: "volunteer_carol",
    timestamp: "2026-11-10T16:00:00Z",
    likesCount: 15,
    commentsCount: 0,
  };

  const res6 = runIsolatedIngestion(db, [rawItemBob, rawItemCarol]);
  assert(res6.postsMatched === 2, "Both volunteers posting same caption must be matched");
  assert(db.matched_posts.has("instagram:post-104") && db.matched_posts.has("instagram:post-105"), "Both posts tracked");
  console.log("✓ INT-06: Same caption across multiple volunteers independently matched and tracked");

  console.log("--- All Matching Workflow Integration Tests Passed! ---");
}

runIntegrationTests();

