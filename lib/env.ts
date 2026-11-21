import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  ACTIVE_SCRAPER_PROVIDER: z.enum(["apify", "brightdata"]).default("apify"),
  // Optional: the token can instead be saved (encrypted) from Settings → Integrations.
  APIFY_API_TOKEN: z.string().optional(),
  // Optional dedicated key for encrypting stored credentials (falls back to the service-role key).
  SETTINGS_ENCRYPTION_KEY: z.string().min(16, "SETTINGS_ENCRYPTION_KEY must be at least 16 characters").optional(),
  // One-time token that allows creating the very first admin through /api/admin/users.
  // If unset, bootstrap via the API is disabled (create the first user in Supabase Auth instead).
  BOOTSTRAP_TOKEN: z.string().min(16, "BOOTSTRAP_TOKEN must be at least 16 characters").optional(),
  APIFY_WEBHOOK_SECRET: z.string().default("not-configured"),
  APIFY_TASK_ID: z.string().optional(),
  APIFY_ACTOR_ID: z.string().optional(),
  APIFY_INSTAGRAM_ACTOR_ID: z.string().optional(),
  APIFY_FACEBOOK_ACTOR_ID: z.string().optional(),
  APIFY_TWITTER_ACTOR_ID: z.string().optional(),
  APIFY_FACEBOOK_POST_ACTOR_ID: z.string().optional(),
  APIFY_TWITTER_POST_ACTOR_ID: z.string().optional(),
  FACEBOOK_COOKIES: z.string().optional(),
  BRIGHTDATA_API_KEY: z.string().optional(),
  BRIGHTDATA_WEBHOOK_SECRET: z.string().optional(),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL").optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Validates and returns server-side environment variables.
 * Throws a descriptive error if any required variables are missing or invalid.
 */
export function getServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ACTIVE_SCRAPER_PROVIDER: process.env.ACTIVE_SCRAPER_PROVIDER,
    APIFY_API_TOKEN: process.env.APIFY_API_TOKEN,
    SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY || undefined,
    BOOTSTRAP_TOKEN: process.env.BOOTSTRAP_TOKEN || undefined,
    APIFY_WEBHOOK_SECRET: process.env.APIFY_WEBHOOK_SECRET,
    APIFY_TASK_ID: process.env.APIFY_TASK_ID,
    APIFY_ACTOR_ID: process.env.APIFY_ACTOR_ID,
    APIFY_INSTAGRAM_ACTOR_ID: process.env.APIFY_INSTAGRAM_ACTOR_ID,
    APIFY_FACEBOOK_ACTOR_ID: process.env.APIFY_FACEBOOK_ACTOR_ID,
    APIFY_TWITTER_ACTOR_ID: process.env.APIFY_TWITTER_ACTOR_ID,
    APIFY_FACEBOOK_POST_ACTOR_ID: process.env.APIFY_FACEBOOK_POST_ACTOR_ID,
    APIFY_TWITTER_POST_ACTOR_ID: process.env.APIFY_TWITTER_POST_ACTOR_ID,
    FACEBOOK_COOKIES: process.env.FACEBOOK_COOKIES,
    BRIGHTDATA_API_KEY: process.env.BRIGHTDATA_API_KEY,
    BRIGHTDATA_WEBHOOK_SECRET: process.env.BRIGHTDATA_WEBHOOK_SECRET,
  });

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((e) => `[${e.path.join(".")}]: ${e.message}`)
      .join(", ");
    throw new Error(`Server environment validation failed: ${errorDetails}`);
  }

  return result.data;
}

/**
 * Validates and returns client-safe environment variables.
 */
export function getClientEnv(): ClientEnv {
  const result = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!result.success) {
    const errorDetails = result.error.errors
      .map((e) => `[${e.path.join(".")}]: ${e.message}`)
      .join(", ");
    throw new Error(`Client environment validation failed: ${errorDetails}`);
  }

  return result.data;
}
