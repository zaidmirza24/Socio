import {
  normalizeCaption,
  computeCaptionHash,
  processCaption,
  segmentCaption,
  countWords,
} from "../lib/matching/normalizer.ts";
import {
  matchCaption,
  jaroSimilarity,
  jaroWinklerSimilarity,
  getAdaptiveThreshold,
  type MatchableCaption,
  type MatchableVariant,
} from "../lib/matching/matcher.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runMatchingTests(): void {
  console.log("--- Starting Normalization & Matching Engine Tests ---");

  // ─────────────────────────────────────────────────────────────
  // 1. Normalization Algorithm & Test Vectors
  // ─────────────────────────────────────────────────────────────

  // Vector 1: Whitespace, Carriage Returns & Case
  const input1 = "   Join us THIS Sunday for our Tree Planting Drive! \r\n\r\nBring gloves.   ";
  const expected1 = "join us this sunday for our tree planting drive!\n\nbring gloves.";
  const normalized1 = normalizeCaption(input1);
  assert(normalized1 === expected1, `Vector 1 failed: expected '${expected1}', got '${normalized1}'`);
  console.log("✓ Vector 1: Whitespace, Carriage Returns & Case normalized correctly");

  // Vector 2: URLs & Emoji Preservation
  const input2 = "Proud of our volunteers 🌿🌱! Register: https://action.org/signup?ref=ig #green";
  const expected2 = "proud of our volunteers 🌿🌱! register: {{url}} #green";
  const normalized2 = normalizeCaption(input2);
  assert(normalized2 === expected2, `Vector 2 failed: expected '${expected2}', got '${normalized2}'`);
  console.log("✓ Vector 2: URLs tokenized to {{url}} and emojis preserved");

  // Vector 3: Platform Truncation Marker Stripping
  const input3 = "Official statement regarding community initiatives... more";
  const expected3 = "official statement regarding community initiatives";
  const normalized3 = normalizeCaption(input3);
  assert(normalized3 === expected3, `Vector 3 failed: expected '${expected3}', got '${normalized3}'`);
  console.log("✓ Vector 3: Platform truncation marker '... more' stripped");

  // Vector 3b: Ellipsis truncation marker
  const input3b = "Important update for the community…";
  const expected3b = "important update for the community";
  assert(normalizeCaption(input3b) === expected3b, "Vector 3b failed");
  console.log("✓ Vector 3b: Trailing unicode ellipsis '…' stripped");

  // Vector 4: Typographic Curly Quotes, Apostrophes & Dashes
  const input4 = "“Plant trees, save earth” – said the ‘volunteer’";
  const expected4 = '"plant trees, save earth" - said the \'volunteer\'';
  assert(normalizeCaption(input4) === expected4, "Vector 4 failed");
  console.log("✓ Vector 4: Typographic curly quotes & dashes normalized to ASCII quotes and hyphens");

  // Vector 4b: Zero-width spaces, invisible formatting & smart apostrophes
  const input4b = "Join\u200B us this Sunday\uFEFF! Register: https://action.org/signup! Great initiative.";
  const expected4b = "join us this sunday! register: {{url}}! great initiative.";
  assert(normalizeCaption(input4b) === expected4b, "Vector 4b failed: zero-width characters or URL punctuation");
  console.log("✓ Vector 4b: Invisible zero-width chars stripped and URL trailing punctuation preserved");

  // Vector 5: 3+ consecutive newlines collapsed to maximum 2 (\n\n)
  const input5 = "Line 1\r\n\r\n\r\n\r\n\r\nLine 2";
  const expected5 = "line 1\n\nline 2";
  assert(normalizeCaption(input5) === expected5, "Vector 5 failed");
  console.log("✓ Vector 5: 5 consecutive newlines collapsed to 2 newlines");

  // ─────────────────────────────────────────────────────────────
  // 2. Cryptographic SHA-256 Hashing
  // ─────────────────────────────────────────────────────────────
  const { normalized, hash } = processCaption(input1);
  assert(hash.length === 64, "Hash must be 64-char hex string");
  assert(/^[a-f0-9]{64}$/.test(hash), "Hash must be lowercase hex");
  assert(computeCaptionHash(normalized) === hash, "Hash must be deterministic");
  console.log("✓ Deterministic SHA-256 hash computed (64-character hex)");

  // ─────────────────────────────────────────────────────────────
  // 3. Jaro & Jaro-Winkler Similarity
  // ─────────────────────────────────────────────────────────────
  assert(jaroSimilarity("hello", "hello") === 1.0, "Identical strings must have similarity 1.0");
  assert(jaroWinklerSimilarity("hello", "hello") === 1.0, "Identical strings must have JW similarity 1.0");
  assert(jaroSimilarity("", "hello") === 0.0, "Empty string comparison must yield 0.0");
  assert(jaroSimilarity("abc", "xyz") === 0.0, "Completely different strings must yield 0.0");

  const jwScore = jaroWinklerSimilarity(
    "join us this sunday for our tree planting drive! bring gloves.",
    "join us this sunday for our tree planting drive! bring glove"
  );
  assert(jwScore >= 0.95, `Expected JW similarity >= 0.95 for minor typo, got ${jwScore}`);
  console.log(`✓ Jaro-Winkler calculated correctly (${jwScore.toFixed(4)} for single-letter typo)`);

  // ─────────────────────────────────────────────────────────────
  // 4. Two-Tier Matching Engine
  // ─────────────────────────────────────────────────────────────
  const canonicalCaptionText = "Join us this Sunday for our Tree Planting Drive! Bring gloves.";
  const { normalized: canonicalNorm, hash: canonicalHash } = processCaption(canonicalCaptionText);

  const activeCaptions: MatchableCaption[] = [
    {
      id: "caption-100",
      canonical_caption: canonicalCaptionText,
      normalized_caption: canonicalNorm,
      caption_hash: canonicalHash,
    },
  ];

  // Test Tier 1A: Exact match (different case and irregular spacing)
  const exactPostCaption = "   Join us THIS Sunday for our Tree Planting Drive!   Bring gloves.  ";
  const res1 = matchCaption(exactPostCaption, activeCaptions);
  assert(res1.matched === true, "Tier 1 exact match should succeed");
  if (res1.matched) {
    assert(res1.tier === "tier1_exact", `Expected tier1_exact, got ${res1.tier}`);
    assert(res1.confidence === 1.0, "Confidence should be 1.0");
    assert(res1.captionId === "caption-100", "Should match caption-100");
    assert(res1.needsReview === false, "Tier 1 should not need review");
  }
  console.log("✓ Tier 1 (Exact Match): Successfully matched normalized hash with confidence 1.0");

  // Test Tier 1B: Approved Variant match
  const variantText = "join us this sunday for our tree planting drive! bring gloves 🌱";
  const { hash: variantHash } = processCaption(variantText);
  const approvedVariants: MatchableVariant[] = [
    {
      caption_id: "caption-100",
      variant_hash: variantHash,
    },
  ];
  const resVariant = matchCaption(variantText, activeCaptions, approvedVariants);
  assert(resVariant.matched === true, "Approved variant should match");
  if (resVariant.matched) {
    assert(resVariant.tier === "manual_approved", `Expected manual_approved, got ${resVariant.tier}`);
    assert(resVariant.captionId === "caption-100", "Should map to caption-100");
  }
  console.log("✓ Tier 1B (Approved Variant): Successfully matched cached variant hash");

  // Test Tier 2: Fuzzy match (volunteer made a typo: omitted 's' from gloves)
  const fuzzyPostCaption = "Join us this Sunday for our Tree Planting Drive! Bring glove.";
  const res2 = matchCaption(fuzzyPostCaption, activeCaptions);
  assert(res2.matched === true, "Tier 2 fuzzy match should succeed for similarity >= 0.90");
  if (res2.matched) {
    assert(res2.tier === "tier2_fuzzy", `Expected tier2_fuzzy, got ${res2.tier}`);
    assert(res2.confidence >= 0.9, `Expected confidence >= 0.90, got ${res2.confidence}`);
    assert(res2.captionId === "caption-100", "Should match caption-100");
    assert(res2.needsReview === true, "Tier 2 fuzzy match MUST require review");
  }
  console.log(`✓ Tier 2 (Fuzzy Match): Matched typo with confidence ${res2.matched ? res2.confidence : 0} -> routed to review queue`);

  // Test Tier 2: Real-world social media case (Prepended greeting + Appended hashtags)
  const realWorldCaption = "Namaste volunteers! Join us this Sunday for our Tree Planting Drive! Bring gloves. #CleanIndia #YouthWing #GreenEarth";
  const resGreetingTags = matchCaption(realWorldCaption, activeCaptions);
  assert(resGreetingTags.matched === true, "Post with greeting and hashtags must match via containment/token similarity");
  if (resGreetingTags.matched) {
    assert(resGreetingTags.tier === "tier2_fuzzy", `Expected tier2_fuzzy, got ${resGreetingTags.tier}`);
    assert(resGreetingTags.confidence >= 0.93, `Expected high confidence for contained caption, got ${resGreetingTags.confidence}`);
    assert(resGreetingTags.captionId === "caption-100", "Should map to caption-100");
    assert(resGreetingTags.needsReview === true, "Contained match with extra text routes to review queue");
  }
  console.log(`✓ Tier 2 (Containment Match): Matched greeting + hashtags with confidence ${resGreetingTags.matched ? resGreetingTags.confidence : 0}`);

  // Test Temporal Embargo Filter
  const datedCaptions: MatchableCaption[] = [
    {
      id: "caption-future",
      canonical_caption: "Celebrate World Environment Day with our plantation drive!",
      normalized_caption: normalizeCaption("Celebrate World Environment Day with our plantation drive!"),
      caption_hash: computeCaptionHash(normalizeCaption("Celebrate World Environment Day with our plantation drive!")),
      released_at: "2026-06-01T09:00:00Z",
    },
  ];
  const oldPostText = "Celebrate World Environment Day with our plantation drive!";
  // Post dated 2 months before campaign release
  const resOldPost = matchCaption(oldPostText, datedCaptions, [], {
    postedAt: "2026-04-01T12:00:00Z",
  });
  assert(resOldPost.matched === false, "Old post before campaign release must not match");
  if (!resOldPost.matched) {
    assert(resOldPost.reason === "outside_embargo_window", `Expected outside_embargo_window, got ${resOldPost.reason}`);
  }
  console.log("✓ Temporal Embargo: Past post published prior to campaign release safely filtered");

  // Test Ambiguity Detection (Two very similar campaigns)
  const similarCaptions: MatchableCaption[] = [
    {
      id: "caption-bandra",
      canonical_caption: "Join us this Sunday at Bandra for Beach Cleanup! Bring bags.",
      normalized_caption: normalizeCaption("Join us this Sunday at Bandra for Beach Cleanup! Bring bags."),
      caption_hash: computeCaptionHash(normalizeCaption("Join us this Sunday at Bandra for Beach Cleanup! Bring bags.")),
    },
    {
      id: "caption-juhu",
      canonical_caption: "Join us this Sunday at Juhu for Beach Cleanup! Bring bags.",
      normalized_caption: normalizeCaption("Join us this Sunday at Juhu for Beach Cleanup! Bring bags."),
      caption_hash: computeCaptionHash(normalizeCaption("Join us this Sunday at Juhu for Beach Cleanup! Bring bags.")),
    },
  ];
  const ambiguousPost = "Join us this Sunday at Beach Cleanup! Bring bags and water.";
  const resAmbiguous = matchCaption(ambiguousPost, similarCaptions);
  assert(resAmbiguous.matched === true, "Ambiguous post should match one candidate");
  if (resAmbiguous.matched) {
    assert(resAmbiguous.isAmbiguous === true, "Should flag isAmbiguous: true when runner-up is within 0.05");
    assert(!!resAmbiguous.alternativeCaptionId, "Should provide alternativeCaptionId for admin review");
  }
  console.log("✓ Ambiguity Detection: Close campaign candidates properly flagged for reviewer clarity");

  // Test Discard: Unrelated post (e.g. personal lunch photo)
  const unrelatedCaption = "Having great pizza with family at downtown cafe! #weekend";
  const res3 = matchCaption(unrelatedCaption, activeCaptions);
  assert(res3.matched === false, "Unrelated caption must NOT match");
  if (!res3.matched) {
    assert(res3.reason === "below_similarity_threshold", `Expected below_similarity_threshold, got ${res3.reason}`);
  }
  console.log("✓ Discard Engine: Unrelated personal post discarded (< 0.90 similarity, 0 rows created)");

  // Test Empty / Null Caption
  const resEmpty = matchCaption("", activeCaptions);
  assert(resEmpty.matched === false && resEmpty.reason === "empty_caption", "Empty caption discarded");
  const resNull = matchCaption(null, activeCaptions);
  assert(resNull.matched === false && resNull.reason === "empty_caption", "Null caption discarded");
  console.log("✓ Discard Engine: Empty/null captions safely rejected");

  // ─────────────────────────────────────────────────────────────
  // 5. Section Segmentation Engine
  // ─────────────────────────────────────────────────────────────
  const multiLineWithSections =
    "Namaste volunteers!\n\nJoin us this Sunday for our Tree Planting Drive! Bring gloves.\n\nRegards, District Youth Wing\n#CleanIndia #GreenEarth";
  const sections1 = segmentCaption(multiLineWithSections);
  assert(sections1.prefix === "namaste volunteers!", `Prefix mismatch: ${sections1.prefix}`);
  assert(
    sections1.cleanBody === "join us this sunday for our tree planting drive! bring gloves.",
    `Clean body mismatch: ${sections1.cleanBody}`
  );
  assert(sections1.hashtags.includes("#cleanindia"), "Must extract #cleanindia");
  assert(sections1.hashtags.includes("#greenearth"), "Must extract #greenearth");
  console.log("✓ Section Segmentation: Accurately extracted prefix, core body, suffix, and hashtags");

  const singleLineWithSections =
    "Namaste all! Join us this Sunday for our Tree Planting Drive! Bring gloves. #CleanIndia #YouthWing";
  const sections2 = segmentCaption(singleLineWithSections);
  assert(sections2.prefix === "namaste all!", `Single-line prefix mismatch: ${sections2.prefix}`);
  assert(
    sections2.cleanBody === "join us this sunday for our tree planting drive! bring gloves.",
    `Single-line clean body mismatch: ${sections2.cleanBody}`
  );
  console.log("✓ Section Segmentation: Accurately extracted single-line greetings and trailing hashtag blocks");

  // ─────────────────────────────────────────────────────────────
  // 6. Dynamic / Adaptive Thresholding Engine
  // ─────────────────────────────────────────────────────────────
  assert(getAdaptiveThreshold(4) === 0.94, "Short captions (<=10 words) must require >= 0.94");
  assert(getAdaptiveThreshold(25) === 0.89, "Medium captions (11-45 words) must require >= 0.89");
  assert(getAdaptiveThreshold(60) === 0.84, "Long captions (>45 words) must require >= 0.84");
  console.log("✓ Dynamic Thresholding: Correctly scaled thresholds across short, medium, and long text lengths");

  // 6A. Short Caption False Positive Defense:
  // Short canonical: 4 words ("Happy Republic Day! #ProudIndian")
  // Personal post: "Happy Independence Day! #ProudIndian with family"
  const shortCanonical = "Happy Republic Day! #ProudIndian";
  const shortCaptions: MatchableCaption[] = [
    {
      id: "caption-republic",
      canonical_caption: shortCanonical,
      normalized_caption: normalizeCaption(shortCanonical),
      caption_hash: computeCaptionHash(normalizeCaption(shortCanonical)),
    },
  ];
  const personalShortPost = "Happy Independence Day! #ProudIndian with family";
  const resShortDefense = matchCaption(personalShortPost, shortCaptions);
  assert(
    resShortDefense.matched === false,
    "Personal holiday post must NOT match short campaign caption (False Positive Defense)"
  );
  console.log("✓ Dynamic Thresholding: Prevented false positive match on short 4-word campaign");

  // 6B. Long Caption Partial-Quote Protection:
  // Long 3-paragraph official press release (70 words)
  const longCanonical =
    "We are proud to announce our nationwide afforestation campaign for 2026. Every citizen has a vital role to play in preserving our ecosystem and planting native trees.\n\nJoin our volunteer chapter this Saturday at 8:00 AM at the city central grounds. Bring reusable water bottles, comfortable walking shoes, and gloves. Refreshments and saplings will be provided on-site.\n\nTogether we can build a greener tomorrow. For questions contact volunteer helpline at 9876543210.";
  const longCaptions: MatchableCaption[] = [
    {
      id: "caption-afforestation",
      canonical_caption: longCanonical,
      normalized_caption: normalizeCaption(longCanonical),
      caption_hash: computeCaptionHash(normalizeCaption(longCanonical)),
    },
  ];

  // Volunteer posts only Paragraph 2 (the call-to-action) with a personal greeting and hashtag
  const volunteerPartialPost =
    "Namaste friends! Join our volunteer chapter this Saturday at 8:00 AM at the city central grounds. Bring reusable water bottles, comfortable walking shoes, and gloves. Refreshments and saplings will be provided on-site. #GreenerTomorrow";
  const resLongPartial = matchCaption(volunteerPartialPost, longCaptions);
  assert(
    resLongPartial.matched === true,
    "Volunteer posting call-to-action paragraph from long press release must be captured (False Negative Defense)"
  );
  if (resLongPartial.matched) {
    assert(resLongPartial.tier === "tier2_fuzzy", "Partial quote routes to review queue");
    assert(resLongPartial.confidence >= 0.90, `Expected high confidence for paragraph match, got ${resLongPartial.confidence}`);
    assert(resLongPartial.captionId === "caption-afforestation", "Must match caption-afforestation");
  }
  console.log(`✓ Dynamic Thresholding: Partial quote from long campaign statement successfully matched (confidence: ${resLongPartial.matched ? resLongPartial.confidence : 0})`);

  console.log("--- All Normalization & Matching Engine Tests Passed! ---");
}

runMatchingTests();
