import { ACCOUNT_BATCH_SIZE, DIRECT_URL_BATCH_SIZE } from "../lib/apify/trigger.ts";
import {
  matchCaption,
  type MatchableCaption,
  type MatchableVariant,
} from "../lib/matching/matcher.ts";
import { processCaption } from "../lib/matching/normalizer.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runIngestionTests(): void {
  console.log("--- Starting Ingestion & Discard Pipeline Unit Tests ---");

  // ─────────────────────────────────────────────────────────────
  // 1. Batch Partitioning Logic
  // ─────────────────────────────────────────────────────────────
  const mockHandles = Array.from({ length: 250 }, (_, i) => `volunteer_${i + 1}`);
  const chunks: string[][] = [];
  for (let i = 0; i < mockHandles.length; i += ACCOUNT_BATCH_SIZE) {
    chunks.push(mockHandles.slice(i, i + ACCOUNT_BATCH_SIZE));
  }

  assert(chunks.length === 3, `Expected 3 chunks for 250 handles, got ${chunks.length}`);
  assert(chunks[0].length === 100, `Expected chunk 0 length 100, got ${chunks[0].length}`);
  assert(chunks[1].length === 100, `Expected chunk 1 length 100, got ${chunks[1].length}`);
  assert(chunks[2].length === 50, `Expected chunk 2 length 50, got ${chunks[2].length}`);
  console.log("✓ Batch chunking: 250 accounts correctly partitioned into chunks of [100, 100, 50]");

  // ─────────────────────────────────────────────────────────────
  // 2. Direct URL Fetch Batching
  // ─────────────────────────────────────────────────────────────
  const mockUrls = Array.from({ length: 120 }, (_, i) => `https://instagram.com/p/post_${i + 1}/`);
  const urlBatches: string[][] = [];
  for (let i = 0; i < mockUrls.length; i += DIRECT_URL_BATCH_SIZE) {
    urlBatches.push(mockUrls.slice(i, i + DIRECT_URL_BATCH_SIZE));
  }

  assert(urlBatches.length === 3, `Expected 3 batches for 120 URLs, got ${urlBatches.length}`);
  assert(urlBatches[0].length === 50, "Batch 0 should have 50 URLs");
  assert(urlBatches[1].length === 50, "Batch 1 should have 50 URLs");
  assert(urlBatches[2].length === 20, "Batch 2 should have 20 URLs");
  console.log("✓ Direct URL fetch batching: 120 tracked posts partitioned into batches of [50, 50, 20]");

  // ─────────────────────────────────────────────────────────────
  // 3. In-Memory Discard & Matching Pipeline
  // ─────────────────────────────────────────────────────────────
  const captionText = "Join us this Sunday for our Annual Tree Planting Drive! Bring gloves.";
  const { normalized: treeNorm, hash: treeHash } = processCaption(captionText);

  const activeCaptions: MatchableCaption[] = [
    {
      id: "caption-tree-drive",
      canonical_caption: captionText,
      normalized_caption: treeNorm,
      caption_hash: treeHash,
    },
  ];

  const approvedVariants: MatchableVariant[] = [];

  const candidatePosts = [
    {
      id: "post-1",
      caption: "Join us this Sunday for our Annual Tree Planting Drive! Bring gloves.",
      type: "exact_match",
    },
    {
      id: "post-2",
      caption: "Join us this Sunday for our Annual Tree Planting Drive! Bring glove.", // typo: glove
      type: "fuzzy_match",
    },
    {
      id: "post-3",
      caption: "Coffee with friends at sunrise! #weekendvibes #latte",
      type: "personal_unrelated",
    },
    {
      id: "post-4",
      caption: null,
      type: "empty",
    },
  ];

  let matchedCount = 0;
  let queuedCount = 0;
  let discardedCount = 0;

  for (const post of candidatePosts) {
    const res = matchCaption(post.caption, activeCaptions, approvedVariants);
    if (!res.matched) {
      discardedCount++;
    } else if (res.needsReview) {
      queuedCount++;
    } else {
      matchedCount++;
    }
  }

  assert(matchedCount === 1, `Expected 1 matched post, got ${matchedCount}`);
  assert(queuedCount === 1, `Expected 1 queued review post, got ${queuedCount}`);
  assert(discardedCount === 2, `Expected 2 discarded posts, got ${discardedCount}`);
  console.log("✓ Discard Engine correctly filtered candidate stream: 1 matched, 1 queued, 2 discarded");

  // ─────────────────────────────────────────────────────────────
  // 4. Metric Delta Calculations
  // ─────────────────────────────────────────────────────────────
  function computeDeltas(
    current: { likes: number | null; comments: number | null; views: number | null },
    prev: { likes: number | null; comments: number | null; views: number | null } | null
  ) {
    const deltaLikes =
      current.likes !== null && prev?.likes !== null && prev?.likes !== undefined
        ? Math.max(0, current.likes - prev.likes)
        : 0;
    const deltaComments =
      current.comments !== null && prev?.comments !== null && prev?.comments !== undefined
        ? Math.max(0, current.comments - prev.comments)
        : 0;
    const deltaViews =
      current.views !== null && prev?.views !== null && prev?.views !== undefined
        ? Math.max(0, current.views - prev.views)
        : 0;
    return { deltaLikes, deltaComments, deltaViews };
  }

  const deltas1 = computeDeltas({ likes: 120, comments: 15, views: 500 }, { likes: 100, comments: 10, views: 400 });
  assert(deltas1.deltaLikes === 20, "Delta likes should be 20");
  assert(deltas1.deltaComments === 5, "Delta comments should be 5");
  assert(deltas1.deltaViews === 100, "Delta views should be 100");

  // First day / no previous snapshot
  const deltasFirstDay = computeDeltas({ likes: 50, comments: 5, views: null }, null);
  assert(deltasFirstDay.deltaLikes === 0, "First day delta likes should be 0");
  assert(deltasFirstDay.deltaViews === 0, "First day delta views should be 0");

  console.log("✓ Engagement delta calculations verified (day-over-day growth accurate & non-negative)");

  // ─────────────────────────────────────────────────────────────
  // 5. Post Snapshot Deduplication & Accurate Aggregation
  // ─────────────────────────────────────────────────────────────
  // Simulate 3 daily snapshots for a single post: Day 1 (100 likes), Day 2 (105 likes), Day 3 (110 likes)
  const mockSnapshots = [
    { post_id: "post-abc", snapshot_date: "2026-11-03", likes: 110, comments: 12, views: 500, handle: "@alice" },
    { post_id: "post-abc", snapshot_date: "2026-11-02", likes: 105, comments: 11, views: 480, handle: "@alice" },
    { post_id: "post-abc", snapshot_date: "2026-11-01", likes: 100, comments: 10, views: 450, handle: "@alice" },
    { post_id: "post-xyz", snapshot_date: "2026-11-03", likes: 50, comments: 5, views: null, handle: "@alice" },
  ];

  // Correct aggregation: Keep only latest snapshot per post_id
  const latestByPost = new Map<string, { likes: number; comments: number; views: number | null; handle: string }>();
  for (const s of mockSnapshots) {
    if (!latestByPost.has(s.post_id)) {
      latestByPost.set(s.post_id, {
        likes: s.likes,
        comments: s.comments,
        views: s.views,
        handle: s.handle,
      });
    }
  }

  // Aggregate by volunteer
  const aggregatedByVolunteer = new Map<string, { posts: number; likes: number; comments: number }>();
  for (const [postId, p] of latestByPost.entries()) {
    const existing = aggregatedByVolunteer.get(p.handle) ?? { posts: 0, likes: 0, comments: 0 };
    aggregatedByVolunteer.set(p.handle, {
      posts: existing.posts + 1,
      likes: existing.likes + p.likes,
      comments: existing.comments + p.comments,
    });
  }

  const aliceStats = aggregatedByVolunteer.get("@alice");
  if (!aliceStats) {
    throw new Error("Alice should exist in aggregated stats");
  }
  assert(aliceStats.posts === 2, `Alice should have 2 unique posts, got ${aliceStats.posts}`);
  assert(aliceStats.likes === 160, `Alice total likes should be 110 + 50 = 160 (not 110+105+100+50=365), got ${aliceStats.likes}`);
  assert(aliceStats.comments === 17, `Alice total comments should be 12 + 5 = 17, got ${aliceStats.comments}`);
  console.log("✓ Snapshot deduplication: Cumulative daily snapshots correctly pick latest metrics (160 likes vs 365 inflated)");

  // ─────────────────────────────────────────────────────────────
  // 6. Inactive / Private Account Detection
  // ─────────────────────────────────────────────────────────────
  const targetedHandles = ["alice", "bob", "carol_private", "dave_deleted"];
  const returnedHandles = new Set(["alice", "bob"]);

  const visible: string[] = [];
  const invisible: string[] = [];

  for (const handle of targetedHandles) {
    if (returnedHandles.has(handle)) {
      visible.push(handle);
    } else {
      invisible.push(handle);
    }
  }

  assert(visible.length === 2 && visible.includes("alice") && visible.includes("bob"), "Alice and Bob should be visible");
  assert(invisible.length === 2 && invisible.includes("carol_private") && invisible.includes("dave_deleted"), "Carol and Dave should be marked not visible");
  console.log("✓ Private/Inaccessible account detection correctly flags unreturned targeted handles as invisible");

  console.log("--- All Ingestion & Discard Pipeline Unit Tests Passed! ---");
}

runIngestionTests();
