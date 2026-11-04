import { ApifyClient } from "apify-client";
import { getServerEnv } from "@/lib/env";

/**
 * Creates an authorized Apify API client instance.
 * Server-only execution.
 */
export function getApifyClient() {
  const env = getServerEnv();
  return new ApifyClient({
    token: env.APIFY_API_TOKEN,
  });
}

/**
 * Validates incoming webhook authorization headers or tokens.
 */
export function verifyWebhookSecret(receivedSecret: string | null | undefined): boolean {
  if (!receivedSecret) {
    return false;
  }
  const expectedSecret = getServerEnv().APIFY_WEBHOOK_SECRET;
  return receivedSecret === expectedSecret;
}
