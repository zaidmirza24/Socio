import { createClient } from "@supabase/supabase-js";
import { getServerEnv, getClientEnv } from "@/lib/env";

/**
 * Creates an elevated Supabase admin client using the service-role key.
 * Strictly forbidden in client components. Used only in secure server
 * execution environments (e.g. Apify webhook receiver and ingestion service).
 */
export function createAdminClient() {
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
    }
  );
}
