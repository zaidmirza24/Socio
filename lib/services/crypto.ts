import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for credentials stored in the database.
 *
 * Key source (in order):
 *   1. SETTINGS_ENCRYPTION_KEY  (recommended - lets you rotate independently)
 *   2. SUPABASE_SERVICE_ROLE_KEY (zero-setup fallback; already server-only)
 *
 * Format: "v1:<iv b64>:<authTag b64>:<ciphertext b64>"
 */

const VERSION = "v1";

function deriveKey(explicitKey?: string): Buffer {
  const material = explicitKey ?? process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!material || material.length < 16) {
    throw new Error(
      "Cannot encrypt credentials: set SETTINGS_ENCRYPTION_KEY (16+ chars) or SUPABASE_SERVICE_ROLE_KEY on the server."
    );
  }
  // Fixed app-specific salt: key material is already high-entropy, this just domain-separates it.
  return createHash("sha256").update(`socio:integration-secrets:v1:${material}`).digest();
}

export function encryptSecret(plaintext: string, explicitKey?: string): string {
  const key = deriveKey(explicitKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(payload: string, explicitKey?: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential has an unrecognised format.");
  }
  const key = deriveKey(explicitKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Could not decrypt stored credential. The encryption key has changed since it was saved - re-enter it in Settings."
    );
  }
}

/** Shows only enough of a secret to recognise it, e.g. "apify_api_Ab…x9Zq". */
export function maskSecret(value: string): string {
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 10)}…${value.slice(-4)}`;
}

/** Constant-time string comparison (prevents timing attacks on webhook secrets). */
export function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export function generateSecret(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}
