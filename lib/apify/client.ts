import { ApifyClient } from "apify-client";
import {
  getApifyConfig,
  getSecret,
  isPlaceholderValue,
} from "../services/integrations.ts";

const isPlaceholder = isPlaceholderValue;

const MISSING_TOKEN_MESSAGE =
  "Apify API token is not configured. Open Settings → Integrations and paste your token " +
  "(or set APIFY_API_TOKEN in .env.local). You can create one at https://console.apify.com/account/integrations";

/**
 * Creates an authorized Apify client using the token saved in Settings (encrypted in DB),
 * falling back to the APIFY_API_TOKEN environment variable. Server-only.
 */
export async function getApifyClientAsync(tokenOverride?: string): Promise<ApifyClient> {
  const token = tokenOverride ?? (await getSecret("apify_api_token")).value;
  if (!token || isPlaceholder(token)) {
    throw new ApifyConfigError(MISSING_TOKEN_MESSAGE);
  }
  return new ApifyClient({ token });
}

/** Task ID from Settings → env → null (caller then falls back to the actor). */
export async function getApifyTaskIdAsync(override?: string): Promise<string | null> {
  if (override && !isPlaceholder(override)) return override.trim();
  return (await getApifyConfig()).taskId;
}

/** Instagram actor ID from Settings → env → built-in default. */
export async function getApifyActorIdAsync(override?: string): Promise<string> {
  if (override && !isPlaceholder(override)) return override.trim();
  return (await getApifyConfig()).actors.instagram.discovery;
}

/**
 * Safely deletes an Apify dataset to enforce zero data retention.
 */
export async function deleteApifyDataset(datasetId: string): Promise<boolean> {
  try {
    const client = await getApifyClientAsync();
    await client.dataset(datasetId).delete();
    return true;
  } catch (err: unknown) {
    console.error(`[Apify] Failed to delete dataset ${datasetId}:`, err);
    return false;
  }
}

/** The Apify account id the saved token belongs to, or null if it cannot be determined. */
export async function getCurrentApifyAccountId(): Promise<string | null> {
  try {
    const client = await getApifyClientAsync();
    const me = await client.user("me").get();
    return me?.id ?? null;
  } catch {
    return null;
  }
}

/** True when Apify refused a token access to a run/dataset (it belongs to another account). */
export function isApifyPermissionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  return statusCode === 403 || /insufficient permissions/i.test(err.message);
}

/** A run exists but the saved token cannot read it. The message is safe to show to the admin. */
export class ApifyRunAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApifyRunAccessError";
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
