import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Shared Sentry configuration for the browser and the server.
 *
 * Kept in one place so the two runtimes cannot drift — the browser scrubbing
 * mattering less than the server's is exactly the sort of asymmetry nobody
 * notices until a service-role key turns up in an issue title.
 *
 * ## What is deliberately not sent
 *
 * This is a multi-tenant system holding another company's store estate, their
 * reps' movements and their trading data. Sentry is a third party.
 *
 *   * `sendDefaultPii: false` — no IPs, no cookies, no usernames attached
 *     automatically.
 *   * {@link scrubEvent} removes credential-shaped values from headers, query
 *     strings and extra data before anything leaves the process.
 *   * Tracing is off. It is a performance feature, and it would spend the free
 *     quota to tell us nothing we need.
 */

/** Header names that must never reach Sentry. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "apikey",
  "cookie",
  "set-cookie",
  "x-supabase-auth",
]);

/** Any key containing one of these is redacted, wherever it appears. */
const SENSITIVE_KEY_PARTS = [
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "service_role",
  "authorization",
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

function scrubRecord(
  input: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!input) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = isSensitiveKey(k) ? "[redacted]" : v;
  }
  return out;
}

/**
 * Last thing that runs before an event is sent.
 *
 * Returning null drops the event entirely, which is what happens for anything
 * raised outside production — a developer's laptop must not post into the
 * stream the business watches.
 */
export function scrubEvent(
  event: ErrorEvent,
  _hint: EventHint
): ErrorEvent | null {
  if (event.environment !== "production") return null;

  if (event.request) {
    if (event.request.headers) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        if (!SENSITIVE_HEADERS.has(k.toLowerCase()) && !isSensitiveKey(k)) {
          headers[k] = v;
        }
      }
      event.request.headers = headers;
    }
    // A query string can carry a recovery token or an access token from an
    // auth redirect. The path is what helps debugging; the parameters are not.
    delete event.request.query_string;
    delete event.request.cookies;
  }

  event.extra = scrubRecord(event.extra);

  return event;
}

/** Options shared by every runtime. */
export const sharedSentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // Vercel exposes the deployed commit, which answers "which release broke
  // this?" without anyone having to remember.
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
  // Off entirely: replay records the screen, and these screens show another
  // company's store data and their reps' locations.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
} as const;

/**
 * Records a business operation for context.
 *
 * These are breadcrumbs, not alerts — they attach to whatever error happens
 * next, which is what turns "a request failed" into "the manager opened the
 * schedule, generated routes, and then it failed".
 *
 * ⚠️ Pass identifiers and counts, never content. A store id is fine; a
 * customer name, an address or a GPS fix is not.
 */
export function recordEvent(
  name: string,
  data?: Record<string, unknown>
): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  // Imported lazily so this module stays usable in contexts where the SDK is
  // not initialised, and so it costs nothing when monitoring is switched off.
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.addBreadcrumb({
      category: "business",
      message: name,
      level: "info",
      data: scrubRecord(data),
    });
  });
}
