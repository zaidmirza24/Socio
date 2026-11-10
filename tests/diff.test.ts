import { computeWordDiff } from "../lib/matching/diff.ts";
import { processCaption } from "../lib/matching/normalizer.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runDiffTests(): void {
  console.log("--- Starting Caption Diff Engine Unit Tests ---");

  // Test 1: Identical strings
  const text1 = "Join us this Sunday for our Tree Planting Drive! Bring gloves.";
  const diff1 = computeWordDiff(text1, text1);
  assert(
    diff1.originalTokens.every((t) => t.type === "unchanged"),
    "Identical strings should have all unchanged tokens in original"
  );
  assert(
    diff1.modifiedTokens.every((t) => t.type === "unchanged"),
    "Identical strings should have all unchanged tokens in modified"
  );
  console.log("✓ Identical captions: 100% unchanged tokens");

  // Test 2: Word modification / addition & omission
  const original = "Join us this Sunday for our Tree Planting Drive! Bring gloves.";
  const modified = "Join us this Sunday for our Tree Planting Drive! Bring glove.";
  const diff2 = computeWordDiff(original, modified);

  const hasRemoved = diff2.originalTokens.some((t) => t.type === "removed" && t.text === "gloves.");
  const hasAdded = diff2.modifiedTokens.some((t) => t.type === "added" && t.text === "glove.");

  assert(hasRemoved, "Original tokens should identify 'gloves.' as removed");
  assert(hasAdded, "Modified tokens should identify 'glove.' as added");
  console.log("✓ Word typo diff: correctly identified omitted 'gloves.' in red and added 'glove.' in green");

  // Test 3: Added phrases
  const orig3 = "Plant trees today for a greener tomorrow #green";
  const mod3 = "Plant trees today with our team for a greener tomorrow #green";
  const diff3 = computeWordDiff(orig3, mod3);

  const addedWords = diff3.modifiedTokens.filter((t) => t.type === "added").map((t) => t.text.trim());
  assert(addedWords.includes("with") && addedWords.includes("our") && addedWords.includes("team"), "Added words should be detected");
  console.log("✓ Insertion diff: correctly detected injected words 'with our team'");

  // Test 4: Learned variant hashing
  const { normalized, hash } = processCaption(modified);
  assert(hash.length === 64, "Learned variant hash must be 64-character hex");
  assert(normalized.includes("bring glove."), "Learned variant must be normalized");
  console.log("✓ Learned variant hashing: normalized text and deterministic hash prepared for caching");

  console.log("--- All Caption Diff Engine Unit Tests Passed! ---");
}

runDiffTests();
