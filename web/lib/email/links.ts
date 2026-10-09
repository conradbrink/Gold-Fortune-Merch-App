import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed links in emails to a company's clients ("stop these emails", and in
 * 8.3 "see and sign this job's report"). The token is the id and an HMAC of
 * it, so a link cannot be guessed or edited into someone else's. Server only.
 *
 * The key is MESSAGE_LINK_SECRET when set, otherwise one derived from the
 * service role key, which the server already holds and never shows.
 */
function key(): Buffer {
  const secret = process.env.MESSAGE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("No secret is configured to sign email links.");
  return createHmac("sha256", secret).update("tickd-email-links-v1").digest();
}

function mac(purpose: string, id: string): string {
  return createHmac("sha256", key()).update(`${purpose}:${id}`).digest("base64url").slice(0, 32);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "<id>.<mac>" for a purpose ("unsubscribe", "report"). */
export function signLink(purpose: string, id: string): string {
  return `${id}.${mac(purpose, id)}`;
}

/** The id inside a token when its signature is right for the purpose; null otherwise. */
export function verifyLink(purpose: string, token: string): string | null {
  const [id, given] = token.split(".");
  if (!id || !given || !UUID.test(id)) return null;
  const want = Buffer.from(mac(purpose, id));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** The app's own address for links in emails. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://app.tickd.co.za").replace(/\/$/, "");
}
