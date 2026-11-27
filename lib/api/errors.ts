import { NextResponse } from "next/server";

/**
 * Logs the real error server-side and returns a generic message, so Postgres/driver details
 * (table names, constraint names, env-validation text) never reach the browser.
 */
export function internalError(err: unknown, publicMessage: string, status = 500): NextResponse {
  return NextResponse.json({ error: logInternal(err, publicMessage) }, { status });
}

/**
 * Same rule for server actions, which return plain objects instead of responses: logs the real
 * error and returns the public message to put in `{ success: false, error }`.
 */
export function logInternal(err: unknown, publicMessage: string): string {
  const detail = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  console.error(`[api] ${publicMessage}:`, detail);
  return publicMessage;
}
