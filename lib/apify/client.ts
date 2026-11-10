import { ApifyClient } from "apify-client";
import { getServerEnv } from "../env.ts";

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.startsWith("your-") ||
    trimmed.includes("placeholder") ||
    trimmed.includes("example") ||
    trimmed === "changeme" ||
    trimmed === "not-configured"
  );
}

/**
 * Creates an authorized Apify API client instance.
 * Server-only execution. Throws a descriptive error if the token is missing or placeholder.
 */
export function getApifyClient(): ApifyClient {
  const env = getServerEnv();

  if (isPlaceholder(env.APIFY_API_TOKEN)) {
    throw new ApifyConfigError(
      "APIFY_API_TOKEN is not configured. Please set a valid Apify API token in your .env.local file. " +
      "You can find your token at https://console.apify.com/account/integrations"
    );
  }

  return new ApifyClient({
    token: env.APIFY_API_TOKEN,
  });
}

/**
 * Resolves which Apify Task ID to use.
 * Returns null if no valid task ID is configured (caller should fall back to actor ID).
 */
export function getApifyTaskId(override?: string): string | null {
  const raw = override || process.env.APIFY_TASK_ID;
  if (!raw || isPlaceholder(raw)) {
    return null;
  }
  return raw.trim();
}

/**
 * Resolves which Apify Actor ID to use.
 */
export function getApifyActorId(override?: string): string {
  const raw = override || process.env.APIFY_ACTOR_ID;
  if (!raw || isPlaceholder(raw)) {
    return "apify/instagram-scraper";
  }
  return raw.trim();
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

/**
 * Safely deletes an Apify dataset to enforce zero data retention.
 */
export async function deleteApifyDataset(datasetId: string): Promise<boolean> {
  try {
    const client = getApifyClient();
    await client.dataset(datasetId).delete();
    return true;
  } catch (err: unknown) {
    console.error(`[Apify] Failed to delete dataset ${datasetId}:`, err);
    return false;
  }
}

/**
 * Custom error class for Apify configuration issues.
 * Allows the API layer to distinguish config errors from runtime errors.
 */
export class ApifyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApifyConfigError";
  }
}

/**
 * Parses Apify SDK errors into user-friendly messages.
 */
export function parseApifyError(err: unknown): { message: string; statusCode: number } {
  if (err instanceof ApifyConfigError) {
    return { message: err.message, statusCode: 400 };
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // Authentication errors
    if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid token")) {
      return {
        message:
          "Apify API authentication failed. Your APIFY_API_TOKEN may be invalid or expired. " +
          "Please verify it at https://console.apify.com/account/integrations",
        statusCode: 401,
      };
    }

    // Not found errors (bad task/actor ID)
    if (msg.includes("404") || msg.includes("not found") || msg.includes("does not exist")) {
      return {
        message:
          "The Apify Task or Actor was not found. Please verify your APIFY_TASK_ID or APIFY_ACTOR_ID " +
          "in .env.local matches an existing resource in your Apify console.",
        statusCode: 404,
      };
    }

    // Rate limits
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many")) {
      return {
        message:
          "Apify rate limit exceeded. Please wait a few minutes before triggering another scraper run.",
        statusCode: 429,
      };
    }

    // Insufficient credits / payment
    if (msg.includes("402") || msg.includes("payment") || msg.includes("credit") || msg.includes("billing")) {
      return {
        message:
          "Apify account has insufficient credits or a billing issue. " +
          "Please check your plan at https://console.apify.com/billing",
        statusCode: 402,
      };
    }

    // Network errors
    if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("fetch failed") || msg.includes("network")) {
      return {
        message:
          "Cannot reach Apify Cloud API. Please check your network connection and try again.",
        statusCode: 503,
      };
    }

    // Generic Apify error — pass through the original message
    return { message: `Apify error: ${err.message}`, statusCode: 500 };
  }

  return { message: "An unexpected error occurred while communicating with Apify.", statusCode: 500 };
}
