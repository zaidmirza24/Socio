import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEBHOOK_SECRET_HEADER,
  buildRunWebhooks,
  parseWebhookRunId,
  verifyWebhookSecret,
} from "../lib/scrapers/apify/webhook.ts";

test("no webhook is attached unless both the base URL and secret are set (local dev)", () => {
  assert.deepEqual(buildRunWebhooks({}), []);
  assert.deepEqual(buildRunWebhooks({ baseUrl: "https://app.example.com" }), []);
  assert.deepEqual(buildRunWebhooks({ secret: "a-long-random-secret-value" }), []);
});

test("webhook points at the receiver and carries the secret header", () => {
  const [hook] = buildRunWebhooks({ baseUrl: "https://app.example.com/", secret: "a-long-random-secret-value" });
  assert.equal(hook.requestUrl, "https://app.example.com/api/webhooks/apify");
  assert.deepEqual(JSON.parse(hook.headersTemplate), { [WEBHOOK_SECRET_HEADER]: "a-long-random-secret-value" });
  assert.ok(hook.eventTypes.includes("ACTOR.RUN.SUCCEEDED"));
  assert.ok(hook.eventTypes.includes("ACTOR.RUN.FAILED"));
});

test("secret check accepts only the exact secret", () => {
  assert.equal(verifyWebhookSecret("s3cret-value-123456", "s3cret-value-123456"), true);
  assert.equal(verifyWebhookSecret("s3cret-value-123457", "s3cret-value-123456"), false);
  assert.equal(verifyWebhookSecret("short", "s3cret-value-123456"), false);
  assert.equal(verifyWebhookSecret(null, "s3cret-value-123456"), false);
  assert.equal(verifyWebhookSecret("anything", undefined), false);
});

test("run id is read from Apify's default payload and bad bodies are rejected", () => {
  assert.equal(
    parseWebhookRunId({ eventType: "ACTOR.RUN.SUCCEEDED", resource: { id: "HG7ML7M8z78YcAPEB", status: "SUCCEEDED" } }),
    "HG7ML7M8z78YcAPEB"
  );
  assert.equal(parseWebhookRunId({ resource: {} }), null);
  assert.equal(parseWebhookRunId({ resource: { id: "../../etc" } }), null);
  assert.equal(parseWebhookRunId(null), null);
  assert.equal(parseWebhookRunId("nope"), null);
});
