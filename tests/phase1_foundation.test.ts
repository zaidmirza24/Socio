import { describe, it } from "node:test";
import assert from "node:assert";
import { normalizeApifyInstagramDataset } from "../lib/scrapers/apify/adapter.ts";
import { PLATFORM_CONFIG, isPlatformEnabled, getPlatformConfig } from "../lib/config/platforms.ts";

describe("Phase 1: Foundation & Platform Engine Verification", () => {
  it("Platform Configuration defaults: Instagram enabled, Facebook/X disabled", () => {
    assert.strictEqual(isPlatformEnabled("instagram"), true);
    assert.strictEqual(isPlatformEnabled("facebook"), false);
    assert.strictEqual(isPlatformEnabled("x"), false);

    const instaConfig = getPlatformConfig("instagram");
    assert.strictEqual(instaConfig.discoveryActorId, "nH2AHrwxeTRJoN5hX");
    assert.strictEqual(instaConfig.refreshActorId, "nH2AHrwxeTRJoN5hX");

    const fbConfig = getPlatformConfig("facebook");
    assert.strictEqual(fbConfig.discoveryActorId, "AtBpiepuIUNs2k2ku");
    assert.strictEqual(fbConfig.refreshActorId, "CaeV1AcRJULMI4vJ3");

    const xConfig = getPlatformConfig("x");
    assert.strictEqual(xConfig.discoveryActorId, "Fo9GoU5wC270BgcBr");
    assert.strictEqual(xConfig.refreshActorId, "73fHdfmMLDzePgHob");
  });

  it("Instagram Adapter Metric Integrity: Hidden likes (-1) converted to null", () => {
    const rawItems = [
      {
        id: "post_hidden_likes_1",
        ownerUsername: "volunteer_1",
        timestamp: "2026-11-20T04:00:00.000Z",
        url: "https://www.instagram.com/p/test1/",
        caption: "Testing hidden likes",
        likesCount: -1, // Instagram returns -1 when likes are hidden
        commentsCount: 15,
        videoViewCount: null,
      },
      {
        id: "post_explicit_zero_likes",
        ownerUsername: "volunteer_2",
        timestamp: "2026-11-20T04:00:00.000Z",
        url: "https://www.instagram.com/p/test2/",
        caption: "Testing zero likes",
        likesCount: 0, // Genuine 0 likes
        commentsCount: 0,
        videoViewCount: null,
      },
      {
        id: "post_normal_likes",
        ownerUsername: "volunteer_3",
        timestamp: "2026-11-20T04:00:00.000Z",
        url: "https://www.instagram.com/p/test3/",
        caption: "Testing normal likes",
        likesCount: 42,
        commentsCount: 5,
        videoViewCount: 200,
      },
    ];

    const result = normalizeApifyInstagramDataset(rawItems);
    assert.strictEqual(result.posts.length, 3);

    // Hidden likes (-1) MUST be null, NEVER 0 or -1
    assert.strictEqual(result.posts[0].metrics.likes, null);
    assert.strictEqual(result.posts[0].metrics.comments, 15);

    // Genuine 0 likes MUST be preserved as 0
    assert.strictEqual(result.posts[1].metrics.likes, 0);
    assert.strictEqual(result.posts[1].metrics.comments, 0);

    // Normal counts preserved
    assert.strictEqual(result.posts[2].metrics.likes, 42);
    assert.strictEqual(result.posts[2].metrics.comments, 5);
    assert.strictEqual(result.posts[2].metrics.views, 200);
  });
});
