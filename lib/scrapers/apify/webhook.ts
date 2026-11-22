import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Header Apify sends back with the shared secret (set through the webhook's headersTemplate). */
export const WEBHOOK_SECRET_HEADER = "x-socio-webhook-secret";

/** Run events worth reacting to. Failures are fetched too so the run row is marked failed at once. */
const WEBHOOK_EVENT_TYPES = [
  "ACTOR.RUN.SUCCEEDED",
  "ACTOR.RUN.FAILED",
  "ACTOR.RUN.TIMED_OUT",
  "ACTOR.RUN.ABORTED",
] as const;

export interface RunWebhookConfig {
  baseUrl?: string;
  secret?: string;
}

export interface RunWebhookSpec {
  eventTypes: (typeof WEBHOOK_EVENT_TYPES)[number][];
  requestUrl: string;
  headersTemplate: string;
}

/**
 * Webhook to attach to every run we start, so Apify calls us when the run ends.
 * Returns an empty list (polling only) unless both the public base URL and the secret are set,
 * which is the normal state on a local machine.
 */
export function buildRunWebhooks(config: RunWebhookConfig): RunWebhookSpec[] {
  if (!config.baseUrl || !config.secret) return [];
  return [
    {
      eventTypes: [...WEBHOOK_EVENT_TYPES],
      requestUrl: `${config.baseUrl.replace(/\/+$/, "")}/api/webhooks/apify`,
      headersTemplate: JSON.stringify({ [WEBHOOK_SECRET_HEADER]: config.secret }),
    },
  ];
}

/** Constant-time comparison, so the secret cannot be guessed from response timing. */
export function verifyWebhookSecret(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const payloadSchema = z.object({
  eventType: z.string().optional(),
  resource: z.object({ id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/) }),
});

/** Extracts the Apify run id from a webhook body, or null if the body is not a run event. */
export function parseWebhookRunId(body: unknown): string | null {
  const parsed = payloadSchema.safeParse(body);
  return parsed.success ? parsed.data.resource.id : null;
}
