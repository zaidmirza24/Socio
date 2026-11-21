import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  TwitterAdapter,
  normalizeTwitterDataset,
  extractTwitterHandle,
  buildTwitterProfileUrl,
} from "../lib/scrapers/twitter/adapter.ts";

describe("Twitter/X Adapter & Normalizer Tests", () => {
  it("extractTwitterHandle extracts clean handles from various URL formats", () => {
    assert.strictEqual(extractTwitterHandle("volunteer_anita"), "volunteer_anita");
    assert.strictEqual(extractTwitterHandle("@volunteer_anita"), "volunteer_anita");
    assert.strictEqual(extractTwitterHandle("https://x.com/volunteer_anita"), "volunteer_anita");
    assert.strictEqual(extractTwitterHandle("https://twitter.com/@rohit_activist"), "rohit_activist");
    assert.strictEqual(
      extractTwitterHandle("https://x.com/volunteer_anita/status/1938336472253534273"),
      "volunteer_anita"
    );
  });

  it("buildTwitterProfileUrl normalizes to x.com profile URLs", () => {
    assert.strictEqual(buildTwitterProfileUrl("volunteer_anita"), "https://x.com/volunteer_anita");
    assert.strictEqual(buildTwitterProfileUrl("@volunteer_anita"), "https://x.com/volunteer_anita");
    assert.strictEqual(
      buildTwitterProfileUrl("https://twitter.com/volunteer_anita"),
      "https://x.com/volunteer_anita"
    );
  });

  it("Parses realistic Twitter/X dataset fixture including views and filters error rows", () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/apify_twitter_dataset.json");
    const rawData = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

    const result = normalizeTwitterDataset(rawData);

    // 4 rows in fixture: 3 valid posts, 1 error row (PAGE_UNAVAILABLE)
    assert.strictEqual(result.posts.length, 3);
    assert.strictEqual(result.accounts.size, 3);

    // Post 1: Anita Roy (Discovery item with views on general post)
    const post1 = result.posts[0];
    assert.strictEqual(post1.platform, "x");
    assert.strictEqual(post1.platform_post_id, "1938336472253534273");
    assert.strictEqual(post1.account_handle, "volunteer_anita");
    assert.strictEqual(post1.metrics.likes, 145);
    assert.strictEqual(post1.metrics.comments, 18);
    assert.strictEqual(post1.metrics.shares, 35);
    // Views present on all Twitter/X post types
    assert.strictEqual(post1.metrics.views, 2450);
    assert.strictEqual(post1.metrics.quotes, 4);
    assert.strictEqual(result.accounts.get("volunteer_anita")?.following, 310);
    assert.strictEqual(post1.thumbnail_url, "https://pbs.twimg.com/media/sample_tweet_pic.jpg");
    assert.strictEqual(post1.media_type, "IMAGE");

    // Post 2: Rohit Das (Explicit 0 counts preserved)
    const post2 = result.posts[1];
    assert.strictEqual(post2.account_handle, "rohit_activist");
    assert.strictEqual(post2.metrics.likes, 0);
    assert.strictEqual(post2.metrics.comments, 0);
    assert.strictEqual(post2.metrics.shares, 0);
    assert.strictEqual(post2.metrics.views, 112);
    assert.strictEqual(post2.metrics.quotes, null); // quoteCount absent -> null, never 0
    assert.strictEqual(result.accounts.get("rohit_activist")?.following, null);
    assert.strictEqual(post2.media_type, "TEXT");

    // Post 3: Sneha Action (Refresh item format)
    const post3 = result.posts[2];
    assert.strictEqual(post3.platform_post_id, "1938336472253534275");
    assert.strictEqual(post3.account_handle, "sneha_action");
    assert.strictEqual(post3.metrics.likes, 88);
    assert.strictEqual(post3.metrics.comments, 12);
    assert.strictEqual(post3.metrics.views, null); // Refresh actor doesn't return viewCount
  });

  it("TwitterAdapter generates compliant discovery and refresh inputs", () => {
    const adapter = new TwitterAdapter();
    assert.strictEqual(adapter.platform, "x");

    // Discovery input
    const discoveryInput = adapter.buildDiscoveryInput(["volunteer_anita", "rohit_activist"]);
    assert.deepStrictEqual(discoveryInput.profileUrls, [
      "https://x.com/volunteer_anita",
      "https://x.com/rohit_activist",
    ]);
    assert.strictEqual(discoveryInput.resultsLimit, 10);
    assert.strictEqual(discoveryInput.skipPinnedPosts, false);

    // Refresh input (Part B per-tweet URLs)
    const refreshInput = adapter.buildRefreshInput([
      "https://x.com/volunteer_anita/status/1938336472253534273",
    ]);
    assert.deepStrictEqual(refreshInput.tweets, [
      "https://x.com/volunteer_anita/status/1938336472253534273",
    ]);
  });
});
