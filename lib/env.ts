import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  APIFY_API_TOKEN: z.string().min(1, "APIFY_API_TOKEN is required"),
  APIFY_WEBHOOK_SECRET: z.string().min(1, "APIFY_WEBHOOK_SECRET is required"),
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
    APIFY_API_TOKEN: process.env.APIFY_API_TOKEN,
    APIFY_WEBHOOK_SECRET: process.env.APIFY_WEBHOOK_SECRET,
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
