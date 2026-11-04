import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { normalizeInstagramDataset } from "../lib/collectors/instagram.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function runTests() {
  console.log("--- Starting Instagram Adapter Unit Tests ---");

  const fixturePath = join(__dirname, "fixtures", "apify_instagram_dataset.json");
  const rawFixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

  const result = normalizeInstagramDataset(rawFixture);

  // Test 1: Number of posts extracted
  if (result.posts.length !== 3) {
    throw new Error(`Expected 3 posts, got ${result.posts.length}`);
  }
  console.log("✓ Correctly parsed 3 posts from fixture");

  // Test 2: Number of unique accounts extracted
  if (result.accounts.size !== 2) {
    throw new Error(`Expected 2 accounts, got ${result.accounts.size}`);
  }
  console.log("✓ Correctly extracted 2 unique accounts (volunteer_alice, volunteer_bob)");

  // Test 3: Metric integrity: null for hidden likes
  const post2 = result.posts[1];
  if (post2.metrics.likes !== null) {
    throw new Error(`Expected likes to be null for post2, got ${post2.metrics.likes}`);
  }
  console.log("✓ Metric integrity verified: hidden likes preserved as null");

  // Test 4: Explicit 0 count preserved
  const post3 = result.posts[2];
  if (post3.metrics.comments !== 0) {
    throw new Error(`Expected comments to be 0 for post3, got ${post3.metrics.comments}`);
  }
  console.log("✓ Metric integrity verified: explicit 0 comments preserved as 0");

  // Test 5: Video views vs photo views
  if (result.posts[0].metrics.views !== null) {
    throw new Error(`Expected photo post views to be null, got ${result.posts[0].metrics.views}`);
  }
  if (post2.metrics.views !== 1890) {
    throw new Error(`Expected video post views to be 1890, got ${post2.metrics.views}`);
  }
  console.log("✓ Views metric verified: photo views is null, video views is 1890");

  console.log("--- All Instagram Adapter Tests Passed Successfully! ---");
}

runTests();
