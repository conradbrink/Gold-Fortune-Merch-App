import "server-only";
import { createSign } from "node:crypto";

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

/** The configuration, or null while any of the three variables is missing or malformed. */
export function gaConfig(env: Record<string, string | undefined> = process.env): GaConfig | null {
  const propertyId = env.GA4_PROPERTY_ID?.trim() || TICKD_PROPERTY_ID;
  const clientEmail = env.GA4_CLIENT_EMAIL?.trim() ?? "";
  const privateKey = (env.GA4_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!/^\d{5,20}$/.test(propertyId)) return null;
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) return null;
  if (!privateKey.includes("PRIVATE KEY")) return null;
  return { propertyId, clientEmail, privateKey };
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

/** Forgets cached answers and the token (tests). */
export function resetGaCache() {
  token = null;
  cache.clear();
}

/** One report. Never throws: a failure is an answer the page shows. */
export async function runReport(
  report: GaReport,
  config: GaConfig | null = gaConfig(),
  fetcher: typeof fetch = fetch
): Promise<GaResult> {
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
