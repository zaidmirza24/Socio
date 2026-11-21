import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert";
import { encryptSecret, decryptSecret, maskSecret, safeEqual, generateSecret } from "../lib/services/crypto.ts";
import { detectCredentials, pickInstagramTask } from "../lib/services/smart-setup.ts";
import { isPlaceholderValue } from "../lib/services/integrations.ts";
import {
  estimateMonthlyCost,
  summarizeUsage,
  istDate,
  type UsageDailyRow,
} from "../lib/services/apify-usage.ts";

const FAKE_TOKEN = "apify_api_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("Credential encryption (AES-256-GCM)", () => {
  it("round-trips a secret and never stores plaintext", () => {
    const enc = encryptSecret(FAKE_TOKEN, "test-key-with-16+chars");
    assert.ok(enc.startsWith("v2:"));
    assert.ok(!enc.includes(FAKE_TOKEN));
    assert.strictEqual(decryptSecret(enc, "test-key-with-16+chars"), FAKE_TOKEN);
  });

  it("uses a fresh IV each time (same input -> different ciphertext)", () => {
    const a = encryptSecret("same", "test-key-with-16+chars");
    const b = encryptSecret("same", "test-key-with-16+chars");
    assert.notStrictEqual(a, b);
  });

  it("rejects a wrong key and tampered data", () => {
    const enc = encryptSecret(FAKE_TOKEN, "test-key-with-16+chars");
    assert.throws(() => decryptSecret(enc, "a-different-key-1234"), /Could not decrypt/);
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    assert.throws(() => decryptSecret(parts.join(":"), "test-key-with-16+chars"));
  });

  it("still reads v1 credentials saved before scrypt key derivation", () => {
    const material = "test-key-with-16+chars";
    const key = createHash("sha256").update(`socio:integration-secrets:v1:${material}`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()]);
    const legacy = ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    assert.strictEqual(decryptSecret(legacy, material), "legacy-secret");
  });

  it("rejects a truncated auth tag", () => {
    const parts = encryptSecret(FAKE_TOKEN, "test-key-with-16+chars").split(":");
    parts[2] = Buffer.from(parts[2], "base64").subarray(0, 4).toString("base64");
    assert.throws(() => decryptSecret(parts.join(":"), "test-key-with-16+chars"), /corrupted/);
  });

  it("decrypts values saved under the service-role fallback after SETTINGS_ENCRYPTION_KEY is added", () => {
    const prevKey = process.env.SETTINGS_ENCRYPTION_KEY;
    const prevRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-material-123";
      delete process.env.SETTINGS_ENCRYPTION_KEY;
      const enc = encryptSecret("saved-before");
      process.env.SETTINGS_ENCRYPTION_KEY = "a-brand-new-dedicated-key-456";
      assert.strictEqual(decryptSecret(enc), "saved-before");
    } finally {
      if (prevKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
      else process.env.SETTINGS_ENCRYPTION_KEY = prevKey;
      if (prevRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevRole;
    }
  });

  it("masks secrets and compares in constant time", () => {
    assert.strictEqual(maskSecret(FAKE_TOKEN), "apify_api_…6789");
    assert.strictEqual(maskSecret("short"), "••••••••");
    assert.strictEqual(safeEqual("abc", "abc"), true);
    assert.strictEqual(safeEqual("abc", "abd"), false);
    assert.strictEqual(safeEqual("abc", "abcd"), false);
    assert.strictEqual(generateSecret().length, 48);
  });
});

describe("Smart-paste credential detection", () => {
  it("finds a bare token", () => {
    const d = detectCredentials(`here you go: ${FAKE_TOKEN} thanks`);
    assert.strictEqual(d.apifyToken, FAKE_TOKEN);
    assert.deepStrictEqual(d.actorIds, []);
  });

  it("parses a pasted .env block and ignores placeholders", () => {
    const d = detectCredentials(
      [
        `APIFY_API_TOKEN=${FAKE_TOKEN}`,
        "APIFY_WEBHOOK_SECRET=abc123secret",
        "APIFY_TASK_ID=your-apify-task-id",
      ].join("\n")
    );
    assert.strictEqual(d.apifyToken, FAKE_TOKEN);
    // Webhook secrets are no longer used (collection is polled), so they are not picked up.
    assert.ok(!d.recognised.some((r) => /webhook/i.test(r)));
    assert.strictEqual(d.taskId, undefined); // placeholder rejected
  });

  it("extracts task and actor IDs from console URLs", () => {
    const d = detectCredentials(
      "task: https://console.apify.com/actors/tasks/Ab12Cd34Ef56Gh78 and actor https://apify.com/apify/instagram-scraper"
    );
    assert.strictEqual(d.taskId, "Ab12Cd34Ef56Gh78");
    assert.ok(d.actorIds.includes("apify/instagram-scraper"));
  });

  it("does not mistake the 'tasks' URL segment for an actor ID", () => {
    const d = detectCredentials("https://console.apify.com/actors/tasks/Ab12Cd34Ef56Gh78/input");
    assert.deepStrictEqual(d.actorIds, []);
  });

  it("returns nothing for unrelated text", () => {
    const d = detectCredentials("hello world");
    assert.strictEqual(d.apifyToken, undefined);
    assert.deepStrictEqual(d.recognised, []);
  });

  it("auto-picks the Instagram task only when unambiguous", () => {
    const tasks = [
      { id: "t1", actId: "nH2AHrwxeTRJoN5hX", name: "daily-insta" },
      { id: "t2", actId: "other", name: "news-scraper" },
    ];
    assert.strictEqual(pickInstagramTask(tasks, "nH2AHrwxeTRJoN5hX").picked?.id, "t1");
    const two = [...tasks, { id: "t3", actId: "x", name: "instagram-backup" }];
    const res = pickInstagramTask(two, "nH2AHrwxeTRJoN5hX");
    assert.strictEqual(res.picked, null);
    assert.strictEqual(res.candidates.length, 2);
  });

  it("recognises placeholder values", () => {
    assert.strictEqual(isPlaceholderValue("your-apify-api-token"), true);
    assert.strictEqual(isPlaceholderValue("not-configured"), true);
    assert.strictEqual(isPlaceholderValue(undefined), true);
    assert.strictEqual(isPlaceholderValue(FAKE_TOKEN), false);
  });
});

describe("Apify credit usage calculations", () => {
  const now = new Date("2026-11-20T06:00:00Z"); // 11:30 IST on 20 Nov
  const cycleStart = new Date("2026-11-01T00:00:00Z");
  const cycleEnd = new Date("2026-12-01T00:00:00Z");
  const noBudget = { monthlyUsd: null, alertThresholdPct: 80 };

  const rows: UsageDailyRow[] = [
    { usage_date: "2026-11-18", platform: "instagram", job_type: "discovery", runs: 1, runs_pending_cost: 0, usage_usd: "0.30", compute_units: 0.1, posts_found: 300, posts_upserted: 40 },
    { usage_date: "2026-11-19", platform: "instagram", job_type: "discovery", runs: 1, runs_pending_cost: 0, usage_usd: 0.3, compute_units: 0.1, posts_found: 300, posts_upserted: 20 },
    { usage_date: "2026-11-19", platform: "instagram", job_type: "refresh", runs: 2, runs_pending_cost: 1, usage_usd: 0.2, compute_units: 0.05, posts_found: 100, posts_upserted: 90 },
    { usage_date: "2026-11-20", platform: "x", job_type: "discovery", runs: 1, runs_pending_cost: 0, usage_usd: 0.1, compute_units: 0.02, posts_found: 50, posts_upserted: 5 },
  ];

  it("totals spend, groups by platform/job type and counts pending runs", () => {
    const s = summarizeUsage(rows, { now, cycleStart, cycleEnd, budget: noBudget });
    assert.strictEqual(s.spentUsd, 0.9);
    assert.strictEqual(s.runs, 5);
    assert.strictEqual(s.runsPendingCost, 1);
    assert.deepStrictEqual(
      s.byPlatform.map((p) => [p.platform, p.usd]),
      [["instagram", 0.8], ["x", 0.1]]
    );
    assert.strictEqual(s.byJobType.find((j) => j.jobType === "refresh")?.usd, 0.2);
  });

  it("builds a zero-filled 30-day series ending today (IST)", () => {
    const s = summarizeUsage(rows, { now, cycleStart, cycleEnd, budget: noBudget });
    assert.strictEqual(s.daily.length, 30);
    assert.strictEqual(s.daily[29].date, istDate(now));
    assert.strictEqual(s.daily[29].usd, 0.1);
    assert.strictEqual(s.daily[0].usd, 0);
  });

  it("projects month-end spend from the daily average", () => {
    const s = summarizeUsage(rows, { now, cycleStart, cycleEnd, budget: noBudget });
    assert.strictEqual(s.daysElapsed, 20);
    assert.strictEqual(s.daysInCycle, 30);
    assert.strictEqual(s.projectedUsd, 1.35); // 0.9 / 20 * 30
  });

  it("measures cost per scraped item and per stored post", () => {
    const s = summarizeUsage(rows, { now, cycleStart, cycleEnd, budget: noBudget });
    assert.strictEqual(s.costPerItemUsd, 0.0012); // 0.9 / 750
    assert.strictEqual(s.costPerStoredPostUsd, 0.00581); // 0.9 / 155
  });

  it("does not project from less than 3 days of data", () => {
    const s = summarizeUsage(rows, { now: new Date("2026-11-02T06:00:00Z"), cycleStart, cycleEnd, budget: noBudget });
    assert.strictEqual(s.projectedUsd, null);
  });

  it("flags budget status: ok / warning / over", () => {
    const at = (monthlyUsd: number) =>
      summarizeUsage(rows, { now, cycleStart, cycleEnd, budget: { monthlyUsd, alertThresholdPct: 80 } }).budget;
    assert.strictEqual(at(10).status, "ok");
    assert.strictEqual(at(1).status, "warning"); // 90%
    assert.strictEqual(at(0.5).status, "over");
    assert.strictEqual(summarizeUsage(rows, { now, cycleStart, cycleEnd, budget: noBudget }).budget.status, "none");
  });

  it("handles an empty history without NaN", () => {
    const s = summarizeUsage([], { now, cycleStart, cycleEnd, budget: noBudget });
    assert.strictEqual(s.spentUsd, 0);
    assert.strictEqual(s.costPerItemUsd, null);
    assert.strictEqual(s.projectedUsd, null);
  });

  it("estimates monthly cost from current settings", () => {
    // 30 accounts x 10 posts x 30 days = 9000 items; 100 tracked posts, weekly refresh = ~429 items
    const e = estimateMonthlyCost({
      activeAccounts: 30,
      discoveryPostLimit: 10,
      trackedPosts: 100,
      refreshIntervalDays: 7,
      costPerItemUsd: 0.0023,
    });
    assert.strictEqual(e.discoveryItemsPerMonth, 9000);
    assert.strictEqual(e.refreshItemsPerMonth, 429);
    assert.strictEqual(e.discoveryUsd, 20.7);
    assert.strictEqual(e.totalUsd, 21.69);
  });
});
