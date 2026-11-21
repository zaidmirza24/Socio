import { createClient } from "@supabase/supabase-js";
import { getServerEnv, getClientEnv } from "../env.ts";

/**
 * Creates an elevated Supabase admin client using the service-role key.
 * Strictly forbidden in client components. Used only in server code (route handlers, server
 * actions, ingestion). The service-role key bypasses RLS.
 */
export function createAdminClient() {
  // Defense in depth: the key is never in a browser bundle (it is not NEXT_PUBLIC_), but fail loudly
  // if this module is ever imported into client code by mistake.
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient() must never run in the browser.");
  }
  const serverEnv = getServerEnv();
  const clientEnv = getClientEnv();

  return createClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: (url, options = {}) =>
          fetch(url, {
            ...options,
            cache: "no-store",
          }),
      },
    }
  );
}
