import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for credentials stored in the database.
 *
 * Key source (in order):
 *   1. SETTINGS_ENCRYPTION_KEY  (recommended - lets you rotate independently)
 *   2. SUPABASE_SERVICE_ROLE_KEY (zero-setup fallback; already server-only)
 * Empty strings count as unset (same rule as lib/env.ts).
 *
 * Formats:
 *   v2:<iv>:<tag>:<ciphertext>  key = scrypt(material)  (written now; resists a weak, human-chosen key)
 *   v1:<iv>:<tag>:<ciphertext>  key = sha256(material)  (read-only, for values saved earlier)
 *
 * Decryption also tries the service-role key, so adding SETTINGS_ENCRYPTION_KEY later does not make
 * credentials saved under the fallback unreadable (re-saving them moves them to the new key).
 */

const AUTH_TAG_LENGTH = 16;
const SCRYPT_SALT = "socio:integration-secrets:v2";
const derivedCache = new Map<string, Buffer>();

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function primaryMaterial(explicitKey?: string): string {
  const material =
    nonEmpty(explicitKey) ??
    nonEmpty(process.env.SETTINGS_ENCRYPTION_KEY) ??
    nonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!material || material.length < 16) {
    throw new Error(
      "Cannot encrypt credentials: set SETTINGS_ENCRYPTION_KEY (16+ chars) or SUPABASE_SERVICE_ROLE_KEY on the server."
    );
  }
  return material;
}

/** Key materials to try when decrypting: the current one, then the service-role fallback. */
function candidateMaterials(explicitKey?: string): string[] {
  const out = [primaryMaterial(explicitKey)];
  const fallback = nonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!explicitKey && fallback && fallback.length >= 16 && !out.includes(fallback)) out.push(fallback);
  return out;
}

function deriveKey(version: "v1" | "v2", material: string): Buffer {
  const cacheKey = `${version}:${createHash("sha256").update(material).digest("hex")}`;
  const cached = derivedCache.get(cacheKey);
  if (cached) return cached;
  const key =
    version === "v2"
      ? scryptSync(material, SCRYPT_SALT, 32, { N: 1 << 14, r: 8, p: 1 })
      : createHash("sha256").update(`socio:integration-secrets:v1:${material}`).digest();
  derivedCache.set(cacheKey, key);
  return key;
}

export function encryptSecret(plaintext: string, explicitKey?: string): string {
  const key = deriveKey("v2", primaryMaterial(explicitKey));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v2", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(payload: string, explicitKey?: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if ((version !== "v1" && version !== "v2") || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential has an unrecognised format.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  // A truncated tag weakens GCM authentication; only full 16-byte tags are accepted.
  if (tag.length !== AUTH_TAG_LENGTH || iv.length !== 12) {
    throw new Error("Stored credential is corrupted.");
  }

  for (const material of candidateMaterials(explicitKey)) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", deriveKey(version, material), iv, {
        authTagLength: AUTH_TAG_LENGTH,
      });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
    } catch {
      // try the next candidate key
    }
  }
  throw new Error(
    "Could not decrypt stored credential. The encryption key has changed since it was saved - re-enter it in Settings."
  );
}

/** Shows only enough of a secret to recognise it, e.g. "apify_api_Ab…x9Zq". */
export function maskSecret(value: string): string {
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 10)}…${value.slice(-4)}`;
}

/** Constant-time string comparison (hashing first makes unequal lengths safe too). */
export function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export function generateSecret(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}
