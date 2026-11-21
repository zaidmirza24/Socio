import { createAdminClient } from "../supabase/admin.ts";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto.ts";
import { PLATFORM_CONFIG } from "../config/platforms.ts";
import type { PlatformType } from "../../types/database.ts";

/**
 * Runtime integration config: lets admins manage the Apify token, webhook secret,
 * task and actor IDs from the Settings page instead of editing .env files.
 *
 * Resolution order for every value:  database (Settings UI)  →  environment variable  →  built-in default.
 * Secrets are AES-256-GCM encrypted in `integration_secrets` (service-role only).
 */

export type SecretName = "apify_api_token" | "apify_webhook_secret";
export type ValueSource = "database" | "environment" | "none";

const SECRET_ENV_FALLBACK: Record<SecretName, string> = {
  apify_api_token: "APIFY_API_TOKEN",
  apify_webhook_secret: "APIFY_WEBHOOK_SECRET",
};

const CACHE_TTL_MS = 30_000;
const secretCache = new Map<SecretName, { value: string | null; source: ValueSource; expires: number }>();
let configCache: { value: StoredApifyConfig; expires: number } | null = null;

export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (!value) return true;
  const t = value.trim().toLowerCase();
  return (
    t === "" ||
    t.startsWith("your-") ||
    t.includes("placeholder") ||
    t.includes("example") ||
    t === "changeme" ||
    t === "not-configured"
  );
}

export function clearIntegrationCache(): void {
  secretCache.clear();
  configCache = null;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export async function getSecret(name: SecretName): Promise<{ value: string | null; source: ValueSource }> {
  const cached = secretCache.get(name);
  if (cached && cached.expires > Date.now()) {
    return { value: cached.value, source: cached.source };
  }

  let resolved: { value: string | null; source: ValueSource } = { value: null, source: "none" };

  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from("integration_secrets").select("ciphertext").eq("key", name).maybeSingle();
    if (data?.ciphertext) {
      resolved = { value: decryptSecret(data.ciphertext), source: "database" };
    }
  } catch (err: unknown) {
    // Table missing (migration not applied) or key changed: fall through to env, but say why.
    console.warn(`[integrations] Could not read stored secret '${name}':`, err instanceof Error ? err.message : err);
  }

  if (!resolved.value) {
    const envValue = process.env[SECRET_ENV_FALLBACK[name]];
    if (envValue && !isPlaceholderValue(envValue)) {
      resolved = { value: envValue, source: "environment" };
    }
  }

  secretCache.set(name, { ...resolved, expires: Date.now() + CACHE_TTL_MS });
  return resolved;
}

export async function setSecret(name: SecretName, value: string, userId?: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("integration_secrets").upsert(
    {
      key: name,
      ciphertext: encryptSecret(value),
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: "key" }
  );
  if (error) {
    throw new Error(
      `Failed to save credential: ${error.message}. ` +
        `If the table is missing, run supabase/migrations/20261121_integrations_and_usage_tracking.sql.`
    );
  }
  secretCache.delete(name);
}

export async function deleteSecret(name: SecretName): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("integration_secrets").delete().eq("key", name);
  if (error) throw new Error(`Failed to remove credential: ${error.message}`);
  secretCache.delete(name);
}

// ---------------------------------------------------------------------------
// Non-secret Apify config (task / actor IDs) stored in system_settings
// ---------------------------------------------------------------------------

export interface StoredApifyConfig {
  task_id?: string | null;
  actors?: Partial<Record<PlatformType, { discovery?: string; refresh?: string }>>;
}

export async function getStoredApifyConfig(): Promise<StoredApifyConfig> {
  if (configCache && configCache.expires > Date.now()) return configCache.value;
  let value: StoredApifyConfig = {};
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.from("system_settings").select("value").eq("key", "apify_config").maybeSingle();
    if (data?.value && typeof data.value === "object") value = data.value as StoredApifyConfig;
  } catch (err: unknown) {
    console.warn("[integrations] Could not read apify_config:", err instanceof Error ? err.message : err);
  }
  configCache = { value, expires: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveStoredApifyConfig(patch: StoredApifyConfig, userId?: string): Promise<StoredApifyConfig> {
  const current = await getStoredApifyConfig();
  const merged: StoredApifyConfig = {
    task_id: patch.task_id === undefined ? current.task_id : patch.task_id,
    actors: { ...(current.actors ?? {}), ...(patch.actors ?? {}) },
  };
  const supabase = createAdminClient();
  const { error } = await supabase.from("system_settings").upsert(
    { key: "apify_config", value: merged, updated_at: new Date().toISOString(), updated_by: userId ?? null },
    { onConflict: "key" }
  );
  if (error) throw new Error(`Failed to save Apify configuration: ${error.message}`);
  configCache = null;
  return merged;
}

export interface ResolvedApifyConfig {
  taskId: string | null;
  taskSource: ValueSource;
  actors: Record<PlatformType, { discovery: string; refresh: string }>;
}

export async function getApifyConfig(): Promise<ResolvedApifyConfig> {
  const stored = await getStoredApifyConfig();

  const envTask = process.env.APIFY_TASK_ID;
  let taskId: string | null = null;
  let taskSource: ValueSource = "none";
  if (stored.task_id && !isPlaceholderValue(stored.task_id)) {
    taskId = stored.task_id.trim();
    taskSource = "database";
  } else if (envTask && !isPlaceholderValue(envTask)) {
    taskId = envTask.trim();
    taskSource = "environment";
  }

  const pick = (platform: PlatformType, kind: "discovery" | "refresh"): string => {
    const fromDb = stored.actors?.[platform]?.[kind];
    if (fromDb && !isPlaceholderValue(fromDb)) return fromDb.trim();
    const cfg = PLATFORM_CONFIG[platform];
    const fromEnv = platform === "instagram" ? process.env.APIFY_ACTOR_ID : undefined;
    if (fromEnv && !isPlaceholderValue(fromEnv)) return fromEnv.trim();
    return kind === "discovery" ? cfg.discoveryActorId : cfg.refreshActorId;
  };

  return {
    taskId,
    taskSource,
    actors: {
      instagram: { discovery: pick("instagram", "discovery"), refresh: pick("instagram", "refresh") },
      facebook: { discovery: pick("facebook", "discovery"), refresh: pick("facebook", "refresh") },
      x: { discovery: pick("x", "discovery"), refresh: pick("x", "refresh") },
    },
  };
}

// ---------------------------------------------------------------------------
// Status snapshot for the Settings UI (never returns raw secrets)
// ---------------------------------------------------------------------------

export interface IntegrationStatus {
  apifyToken: { configured: boolean; source: ValueSource; masked: string | null };
  webhookSecret: { configured: boolean; source: ValueSource; masked: string | null };
  taskId: string | null;
  taskSource: ValueSource;
  actors: ResolvedApifyConfig["actors"];
  webhookUrl: string | null;
  encryptionKeySource: "SETTINGS_ENCRYPTION_KEY" | "SUPABASE_SERVICE_ROLE_KEY (fallback)";
}

export function getWebhookUrl(appUrlOverride?: string): string | null {
  const base = (appUrlOverride ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/api/webhooks/apify`;
}

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  const [token, whSecret, config] = await Promise.all([
    getSecret("apify_api_token"),
    getSecret("apify_webhook_secret"),
    getApifyConfig(),
  ]);
  return {
    apifyToken: { configured: !!token.value, source: token.source, masked: token.value ? maskSecret(token.value) : null },
    webhookSecret: {
      configured: !!whSecret.value,
      source: whSecret.source,
      masked: whSecret.value ? maskSecret(whSecret.value) : null,
    },
    taskId: config.taskId,
    taskSource: config.taskSource,
    actors: config.actors,
    webhookUrl: getWebhookUrl(),
    encryptionKeySource: process.env.SETTINGS_ENCRYPTION_KEY
      ? "SETTINGS_ENCRYPTION_KEY"
      : "SUPABASE_SERVICE_ROLE_KEY (fallback)",
  };
}
