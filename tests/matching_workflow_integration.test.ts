/**
 * Matching workflow test: raw Instagram items -> adapter -> REAL routing decision
 * (lib/services/post-routing.ts, the same function lib/services/ingestion.ts uses) -> an in-memory
 * store that applies each route the way ingestion does.
 *
 * Rules checked (AGENTS.md): every post of a monitored account is KEPT with its engagement;
 * matching only labels it. Rejected posts are never re-queued. Caption filter OFF = no matching.
 * Re-running the same input creates no duplicates.
 *
 * Run: node --no-warnings --experimental-strip-types tests/matching_workflow_integration.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeApifyInstagramDataset } from "../lib/scrapers/apify/adapter.ts";
import { matchCaption, type MatchableCaption, type MatchableVariant } from "../lib/matching/matcher.ts";
import { processCaption } from "../lib/matching/normalizer.ts";
import { routePost } from "../lib/services/post-routing.ts";
import type { PostMatchStatus } from "../types/database.ts";

interface Store {
  accounts: Set<string>;
  posts: Map<string, { matchStatus: PostMatchStatus; captionId: string | null; likes: number | null }>;
  reviewQueue: Map<string, { status: "pending" | "approved" | "rejected"; captionId: string }>;
  matchedPosts: Map<string, { captionId: string; tier: string }>;
  snapshots: Map<string, { likes: number | null }>; // key: post + date (one per post per day)
}

const TODAY = "2026-11-10";

function newStore(): Store {
  return {
    accounts: new Set(["volunteer_alice", "volunteer_bob", "volunteer_carol"]),
    posts: new Map(),
    reviewQueue: new Map(),
    matchedPosts: new Map(),
    snapshots: new Map(),
  };
}

const OFFICIAL = "Join us this Sunday for our Annual Tree Planting Drive! Bring gloves and water bottles.";
const { normalized, hash } = processCaption(OFFICIAL);
const captions: MatchableCaption[] = [
  {
    id: "cap-tree",
    caption_hash: hash,
    canonical_caption: OFFICIAL,
    normalized_caption: normalized,
    released_at: `${TODAY}T03:00:00Z`,
  },
];
const variants: MatchableVariant[] = [];

/** Applies routes like ingestion.ts does (upserts keyed like the real unique constraints). */
function ingest(store: Store, rawItems: unknown[], captionMatchingEnabled = true) {
  const { posts } = normalizeApifyInstagramDataset(rawItems);
  const counts = { kept: 0, queued: 0, tracked: 0, skipped: 0 };

  for (const post of posts) {
    if (!store.accounts.has(post.account_handle)) {
      counts.skipped++;
      continue;
    }
    const key = `${post.platform}:${post.platform_post_id}`;
    const route = routePost({
      captionMatchingEnabled,
      existingReviewStatus: store.reviewQueue.get(key)?.status,
      match: () => matchCaption(post.caption, captions, variants, { postedAt: post.posted_at, sameDayOnly: true }),
    });

    const existing = store.posts.get(key);
    let label: { matchStatus: PostMatchStatus; captionId: string | null } | null = null;

    switch (route.action) {
      case "store_unlabelled":
        break;
      case "label":
        label = { matchStatus: route.matchStatus, captionId: route.captionId };
        break;
      case "queue_review": {
        const prev = store.reviewQueue.get(key);
        // status is never overwritten on conflict (the real upsert omits it)
        store.reviewQueue.set(key, { status: prev?.status ?? "pending", captionId: route.captionId });
        label = { matchStatus: "needs_review", captionId: route.captionId };
        counts.queued++;
        break;
      }
      case "track_match":
        store.matchedPosts.set(key, { captionId: route.match.captionId, tier: route.match.tier });
        label = { matchStatus: "matched", captionId: route.match.captionId };
        counts.tracked++;
        break;
    }

    store.posts.set(key, {
      matchStatus: label?.matchStatus ?? existing?.matchStatus ?? "unmatched",
      captionId: label ? label.captionId : existing?.captionId ?? null,
      likes: post.metrics.likes,
    });
    store.snapshots.set(`${key}@${TODAY}`, { likes: post.metrics.likes });
    counts.kept++;
  }
  return counts;
}

const item = (id: string, owner: string, caption: string, likes = 10) => ({
  id,
  url: `https://www.instagram.com/p/${id}/`,
  caption,
  ownerUsername: owner,
  timestamp: `${TODAY}T10:00:00Z`,
  likesCount: likes,
  commentsCount: 1,
});

const exact = item("post-101", "volunteer_alice", `   ${OFFICIAL}   `, 45);
const unrelated = item("post-102", "volunteer_alice", "Sunday brunch with friends! Best avocado toast ever #weekend", 120);
const typo = item("post-103", "volunteer_bob", "Join us this Sunday for our Annual Tree Planting Drive! Bring glove and water bottle.", 22);

describe("Matching workflow (real routing)", () => {
  it("INT-01: exact caption -> tracked in matched_posts, labelled matched, snapshot stored", () => {
    const store = newStore();
    const r = ingest(store, [exact]);
    assert.equal(r.tracked, 1);
    assert.equal(store.matchedPosts.get("instagram:post-101")?.captionId, "cap-tree");
    assert.equal(store.posts.get("instagram:post-101")?.matchStatus, "matched");
    assert.equal(store.snapshots.size, 1);
  });

  it("INT-02: unrelated post is KEPT with its engagement, labelled unmatched (nothing discarded)", () => {
    const store = newStore();
    const r = ingest(store, [unrelated]);
    assert.equal(r.kept, 1);
    assert.equal(store.posts.get("instagram:post-102")?.matchStatus, "unmatched");
    assert.equal(store.posts.get("instagram:post-102")?.likes, 120);
    assert.equal(store.matchedPosts.size, 0);
    assert.equal(store.reviewQueue.size, 0);
  });

  it("INT-03: typo -> review queue (pending), post kept as needs_review", () => {
    const store = newStore();
    const r = ingest(store, [typo]);
    assert.equal(r.queued, 1);
    assert.equal(store.reviewQueue.get("instagram:post-103")?.status, "pending");
    assert.equal(store.posts.get("instagram:post-103")?.matchStatus, "needs_review");
  });

  it("INT-04: re-running identical input creates no duplicates and one snapshot per post per day", () => {
    const store = newStore();
    ingest(store, [exact, unrelated, typo]);
    ingest(store, [exact, unrelated, typo]);
    assert.equal(store.posts.size, 3);
    assert.equal(store.matchedPosts.size, 1);
    assert.equal(store.reviewQueue.size, 1);
    assert.equal(store.snapshots.size, 3);
  });

  it("INT-05: a rejected post is never re-queued, stays 'rejected', and is still kept", () => {
    const store = newStore();
    ingest(store, [typo]);
    store.reviewQueue.get("instagram:post-103")!.status = "rejected";
    const r = ingest(store, [typo]);
    assert.equal(r.queued, 0);
    assert.equal(store.reviewQueue.get("instagram:post-103")?.status, "rejected");
    assert.equal(store.posts.get("instagram:post-103")?.matchStatus, "rejected");
  });

  it("INT-06: an approved fuzzy post is labelled matched on later runs, not re-queued", () => {
    const store = newStore();
    ingest(store, [typo]);
    store.reviewQueue.get("instagram:post-103")!.status = "approved";
    const r = ingest(store, [typo]);
    assert.equal(r.queued, 0);
    assert.equal(store.posts.get("instagram:post-103")?.matchStatus, "matched");
  });

  it("INT-07: same caption from several volunteers is tracked independently", () => {
    const store = newStore();
    const r = ingest(store, [item("post-104", "volunteer_bob", OFFICIAL), item("post-105", "volunteer_carol", OFFICIAL)]);
    assert.equal(r.tracked, 2);
  });

  it("INT-08: caption filter OFF -> no matching at all, every post kept unlabelled", () => {
    const store = newStore();
    const r = ingest(store, [exact, unrelated, typo], false);
    assert.equal(r.kept, 3);
    assert.equal(r.tracked + r.queued, 0);
    assert.equal(store.matchedPosts.size, 0);
    assert.ok(Array.from(store.posts.values()).every((p) => p.matchStatus === "unmatched"));
  });

  it("INT-09: posts from handles that are not monitored accounts are skipped and counted", () => {
    const store = newStore();
    const r = ingest(store, [item("post-200", "someone_else", OFFICIAL)]);
    assert.equal(r.skipped, 1);
    assert.equal(store.posts.size, 0);
  });
});
