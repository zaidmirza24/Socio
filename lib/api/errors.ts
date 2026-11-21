import { NextResponse } from "next/server";

/**
 * Logs the real error server-side and returns a generic message, so Postgres/driver details
 * (table names, constraint names, env-validation text) never reach the browser.
 */
export function internalError(err: unknown, publicMessage: string, status = 500): NextResponse {
  const detail = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
  console.error(`[api] ${publicMessage}:`, detail);
  return NextResponse.json({ error: publicMessage }, { status });
}
