import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  FacebookAdapter,
  normalizeFacebookDataset,
  extractFacebookHandle,
  buildFacebookProfileUrl,
} from "../lib/scrapers/facebook/adapter.ts";

describe("Facebook Adapter & Normalizer Tests", () => {
  it("extractFacebookHandle extracts clean handles from various URL formats", () => {
    assert.strictEqual(extractFacebookHandle("volunteer.rahul"), "volunteer.rahul");
    assert.strictEqual(extractFacebookHandle("https://www.facebook.com/volunteer.rahul/"), "volunteer.rahul");
    assert.strictEqual(extractFacebookHandle("https://facebook.com/priya_campaigner"), "priya_campaigner");
    assert.strictEqual(extractFacebookHandle("https://www.facebook.com/profile.php?id=100089271625341"), "100089271625341");
    assert.strictEqual(extractFacebookHandle("@amit.singh"), "amit.singh");
    // Post URLs: the owner is the first segment, not the trailing pfbid post id
    assert.strictEqual(
      extractFacebookHandle("https://www.facebook.com/rahul.v/posts/pfbid02abcDEF123"),
      "rahul.v"
    );
    assert.strictEqual(extractFacebookHandle("https://www.facebook.com/people/Rahul-Sharma/100012345/"), "100012345");
    assert.strictEqual(extractFacebookHandle("https://www.facebook.com/permalink.php?story_fbid=1&id=4242"), "4242");
    // A display name with spaces is not a handle
    assert.strictEqual(extractFacebookHandle("Rahul Sharma"), "");
  });

  it("buildFacebookProfileUrl constructs clean Facebook profile URLs", () => {
    assert.strictEqual(buildFacebookProfileUrl("volunteer.rahul"), "https://www.facebook.com/volunteer.rahul/");
    assert.strictEqual(buildFacebookProfileUrl("@volunteer.rahul"), "https://www.facebook.com/volunteer.rahul/");
    assert.strictEqual(buildFacebookProfileUrl("https://www.facebook.com/volunteer.rahul/"), "https://www.facebook.com/volunteer.rahul/");
  });

  it("Parses realistic Facebook dataset fixture into canonical NormalizedPostItem[]", () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/apify_facebook_dataset.json");
    const rawData = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    const result = normalizeFacebookDataset(rawData);
    assert.strictEqual(result.posts.length, 3);
    assert.strictEqual(result.accounts.size, 3);

    // Post 1: Rahul Verma
    const post1 = result.posts[0];
    assert.strictEqual(post1.platform, "facebook");
    assert.strictEqual(post1.platform_post_id, "1234567890");
    assert.strictEqual(post1.account_handle, "volunteer.rahul");
    assert.strictEqual(post1.metrics.likes, 142);
    assert.strictEqual(post1.metrics.comments, 28);
    assert.strictEqual(post1.metrics.shares, 12);
    assert.strictEqual(post1.metrics.views, null); // Views MUST be null for Facebook
    assert.strictEqual(post1.thumbnail_url, "https://scontent.xx.fbcdn.net/v/sample_fb_image.jpg");
    assert.strictEqual(post1.media_type, "IMAGE");

    // Post 2: Priya Sharma (Explicit 0 counts)
    const post2 = result.posts[1];
    assert.strictEqual(post2.account_handle, "priya_campaigner");
    assert.strictEqual(post2.metrics.likes, 0);
    assert.strictEqual(post2.metrics.comments, 0);
    assert.strictEqual(post2.metrics.shares, 0);
    assert.strictEqual(post2.metrics.views, null);
    assert.strictEqual(post2.media_type, "TEXT");

    // Post 3: Amit Singh (Shares available)
    const post3 = result.posts[2];
    assert.strictEqual(post3.account_handle, "amit.singh.social");
    assert.strictEqual(post3.metrics.likes, 350);
    assert.strictEqual(post3.metrics.comments, 45);
    assert.strictEqual(post3.metrics.shares, 85);
    assert.strictEqual(post3.metrics.views, null);
  });

  it("FacebookAdapter generates compliant discovery and refresh inputs", () => {
    const adapter = new FacebookAdapter();
    assert.strictEqual(adapter.platform, "facebook");

    // Discovery input
    const discoveryInput = adapter.buildDiscoveryInput(["volunteer.rahul", "priya_campaigner"], "2026-02-15");
    assert.deepStrictEqual(discoveryInput.urls, [
      "https://www.facebook.com/volunteer.rahul/",
      "https://www.facebook.com/priya_campaigner/",
    ]);
    assert.strictEqual(discoveryInput.count, 10);
    assert.strictEqual(discoveryInput.sortType, "new_posts");
    assert.strictEqual(discoveryInput.scrapeUntil, "2026-02-15");

    // Refresh input (Part B per-post URLs)
    const refreshInput = adapter.buildRefreshInput([
      "https://www.facebook.com/volunteer.rahul/posts/1234567890",
    ]);
    assert.deepStrictEqual(refreshInput.postUrls, [
      "https://www.facebook.com/volunteer.rahul/posts/1234567890",
    ]);
    assert.strictEqual(refreshInput.maxPosts, 1);
  });
});
