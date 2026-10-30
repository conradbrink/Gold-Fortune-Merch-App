import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealing a company's Sage sign-in before it is stored (`accounting_secrets`,
 * service role only), so a copy of the database alone does not give anyone
 * the way into a company's books.
 *
 * AES-256-GCM with the server's ACCOUNTING_SECRET_KEY (32 bytes, base64). The
 * company's id is bound in as associated data, so a sealed sign-in moved to
 * another company's row does not open.
 *
 * Format: "v1." + base64url(iv 12 bytes | tag 16 bytes | ciphertext).
 */

const PREFIX = "v1.";

/** The key from the server's environment, or null when it is missing or not 32 bytes. */
export function secretKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.ACCOUNTING_SECRET_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function seal(value: unknown, orgId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(orgId, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The sealed value, or null when it was not sealed with this key for this company. */
export function open<T = unknown>(sealed: string, orgId: string, key: Buffer): T | null {
  if (!sealed.startsWith(PREFIX)) return null;
  const raw = Buffer.from(sealed.slice(PREFIX.length), "base64url");
  if (raw.length < 12 + 16 + 1) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(orgId, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
