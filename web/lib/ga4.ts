import "server-only";
import { createPrivateKey, createSign } from "node:crypto";

/**
 * Google Analytics 4, read on the server for the operator's Acquisition pages.
 *
 * The website (tickd.co.za) sends visits to GA4; this reads the numbers back
 * through the GA Data API with a read-only service account (Viewer on the
 * property). The property is Tickd's (558341664, the owner's "tickd.co.za";
 * not a secret, so it is the default here). Two secrets, set by the owner in
 * Vercel and never in the repo:
 *
 *   GA4_CLIENT_EMAIL   the service account's email
 *   GA4_PRIVATE_KEY    its private key (PEM; "\n" escapes are accepted)
 *   GA4_PROPERTY_ID    optional: another property's number (not the G- ID)
 *
 * Without the two secrets every call answers { ok: false, reason: "not-connected" } and
 * the pages say Google Analytics isn't connected; nothing is invented.
 *
 * No Google library: the token is a signed JWT exchanged at Google's token
 * endpoint (RS256 with node:crypto), and reports are one REST call each.
 * Answers are kept for ten minutes per server instance, so moving between the
 * pages does not ask Google again (spec section 43).
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const CACHE_MS = 10 * 60 * 1000;
/** Tickd's GA4 property (tickd.co.za, web stream G-7Q710H1MSW). */
export const TICKD_PROPERTY_ID = "558341664";

export type GaConfig = { propertyId: string; clientEmail: string; privateKey: string };

export type GaRow = { dimensions: string[]; metrics: number[] };
export type GaResult = { ok: true; rows: GaRow[] } | { ok: false; reason: "not-connected" | "error"; message?: string };

export type GaReport = {
  dateRanges: { startDate: string; endDate: string; name?: string }[];
  dimensions?: string[];
  metrics: string[];
  dimensionFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
};

/**
 * A value as pasted into Vercel, forgiving the usual slips: spaces, the quote
 * marks and trailing comma copied from the JSON key file, and "\n" escapes in
 * the key. A whole key file pasted into either variable is read too.
 */
function fromKeyFile(raw: string | undefined, field: "client_email" | "private_key"): string {
  let v = (raw ?? "").trim();
  if (v.startsWith("{")) {
    try {
      const parsed = JSON.parse(v) as Record<string, unknown>;
      return typeof parsed[field] === "string" ? (parsed[field] as string).trim() : "";
    } catch {
      /* not the whole file after all: read it as a plain value */
    }
  }
  // The whole line copied, label included: "private_key": "-----BEGIN…",
  v = v.replace(new RegExp(`^"?${field}"?\\s*:\\s*`), "");
  v = v.replace(/,$/, "").trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v.replace(/\\n/g, "\n").trim();
}

/**
 * The configuration, or the reason it can't be used, naming the variable and
 * never its value (the operator reads this on the Acquisition pages).
 */
export function gaSetup(
  env: Record<string, string | undefined> = process.env
): { ok: true; config: GaConfig } | { ok: false; problem: string } {
  const where = "Check it's in the Vercel project \"app\" for Production, then redeploy.";
  const propertyId = env.GA4_PROPERTY_ID?.trim() || TICKD_PROPERTY_ID;
  if (!/^\d{5,20}$/.test(propertyId)) {
    return { ok: false, problem: "GA4_PROPERTY_ID isn't a property number (digits only, not the G- ID)." };
  }
  const clientEmail = fromKeyFile(env.GA4_CLIENT_EMAIL, "client_email");
  if (!clientEmail) return { ok: false, problem: `GA4_CLIENT_EMAIL isn't set in this deployment. ${where}` };
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    return { ok: false, problem: "GA4_CLIENT_EMAIL doesn't look like a service account email (it should end in .iam.gserviceaccount.com)." };
  }
  const privateKey = fromKeyFile(env.GA4_PRIVATE_KEY, "private_key");
  if (!privateKey) return { ok: false, problem: `GA4_PRIVATE_KEY isn't set in this deployment. ${where}` };
  if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
    return { ok: false, problem: "GA4_PRIVATE_KEY should run from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----; part of it is missing." };
  }
  try {
    createPrivateKey(privateKey);
  } catch {
    return { ok: false, problem: "GA4_PRIVATE_KEY couldn't be read as a key; part of it may not have been copied." };
  }
  return { ok: true, config: { propertyId, clientEmail, privateKey } };
}

/** The configuration, or null while it is missing or unusable (see `gaSetup` for why). */
export function gaConfig(env: Record<string, string | undefined> = process.env): GaConfig | null {
  const setup = gaSetup(env);
  return setup.ok ? setup.config : null;
}

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** The signed assertion Google exchanges for an access token. */
export function signedAssertion(config: GaConfig, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: config.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(config.privateKey).toString("base64url")}`;
}

let token: { value: string; expiresAt: number; email: string } | null = null;
const cache = new Map<string, { at: number; result: GaResult }>();

async function accessToken(config: GaConfig, fetcher: typeof fetch): Promise<string> {
  const now = Date.now();
  if (token && token.email === config.clientEmail && token.expiresAt - 60_000 > now) return token.value;
  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signedAssertion(config, Math.floor(now / 1000)),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google refused the sign-in: ${body.error_description ?? res.status}`);
  }
  token = { value: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000, email: config.clientEmail };
  return token.value;
}

let setupOnce: ReturnType<typeof gaSetup> | null = null;

/** Forgets cached answers, the token and the setup (tests). */
export function resetGaCache() {
  token = null;
  setupOnce = null;
  cache.clear();
}

/** One report. Never throws: a failure is an answer the page shows. */
export async function runReport(
  report: GaReport,
  config?: GaConfig | null,
  fetcher: typeof fetch = fetch
): Promise<GaResult> {
  if (config === undefined) {
    // Worked out once per server instance: the variables can't change within a deployment.
    setupOnce ??= gaSetup();
    const setup = setupOnce;
    if (!setup.ok) return { ok: false, reason: "not-connected", message: setup.problem };
    config = setup.config;
  }
  if (!config) return { ok: false, reason: "not-connected" };
  const key = config.propertyId + JSON.stringify(report);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  let result: GaResult;
  try {
    const res = await fetcher(
      `https://analyticsdata.googleapis.com/v1beta/properties/${config.propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await accessToken(config, fetcher)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...report,
          dimensions: report.dimensions?.map((name) => ({ name })),
          metrics: report.metrics.map((name) => ({ name })),
        }),
      }
    );
    const body = (await res.json().catch(() => ({}))) as {
      rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      result = { ok: false, reason: "error", message: body.error?.message ?? `Google answered ${res.status}` };
    } else {
      result = {
        ok: true,
        rows: (body.rows ?? []).map((r) => ({
          dimensions: (r.dimensionValues ?? []).map((d) => d.value ?? ""),
          metrics: (r.metricValues ?? []).map((m) => Number(m.value ?? 0) || 0),
        })),
      };
    }
  } catch (e) {
    result = { ok: false, reason: "error", message: e instanceof Error ? e.message : String(e) };
  }
  // Failures are not kept, so a fixed setting shows at once.
  if (result.ok) {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
    cache.set(key, { at: now, result });
  }
  return result;
}
