import { reportSupabaseFailure } from "@/lib/monitoring";

/**
 * The `fetch` every Supabase client in the app is given.
 *
 * Now and then the API refuses a good token as "JWT issued at future"
 * (PGRST303, HTTP 401): the server that checked the token was a moment
 * behind the clock of the one that issued it. It is about one request a day,
 * from the browser, the server and the phones alike, with every kind of key,
 * and the same token works straight after: in the production logs a call 8 ms
 * later with the same key succeeded. On 8 October 2026 one of these took the
 * sign-up page down for a visitor (Sentry JAVASCRIPT-NEXTJS-2).
 *
 * So a request refused that way is sent once more after a short pause. Only
 * that refusal: the token is checked before the database runs anything, so a
 * write sent again cannot happen twice. Anything else, including a second
 * refusal, comes back to the caller as it was.
 */

/** How long to wait before sending a refused request again, in ms. */
export const SKEW_RETRY_DELAY_MS = 250;

type Fetch = typeof fetch;

/** `baseFetch` with the one retry above. `sleep` is there for the tests. */
export function withSkewRetry(
  baseFetch: Fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 401 || !canSendAgain(input, init)) return response;
    if (!(await issuedAtFuture(response))) return response;
    // Let the refused answer go, so on the server its connection is free
    // again now rather than whenever it is garbage collected.
    await response.body?.cancel().catch(() => {});
    await sleep(SKEW_RETRY_DELAY_MS);
    // A signal of its own. While a page renders, Next hands back its first
    // answer to a GET it has already seen (same URL and headers) unless the
    // request carries a signal, so without one this would get the refusal again.
    return baseFetch(input, { ...init, signal: init?.signal ?? new AbortController().signal });
  };
}

/**
 * The API's requests are a URL and a string body (or none). A `Request` or a
 * stream body may already have been read, so those are never sent twice.
 */
function canSendAgain(input: Parameters<Fetch>[0], init: Parameters<Fetch>[1]): boolean {
  if (typeof Request !== "undefined" && input instanceof Request) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string";
}

/** Read from a copy, so the caller can still read the answer itself. */
async function issuedAtFuture(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.clone().json();
    return typeof body === "object" && body !== null && (body as { code?: unknown }).code === "PGRST303";
  } catch {
    return false;
  }
}

// ------------------------------------------------- failures nobody would hear of

/**
 * Most pages catch a failed save and show it on screen ("Couldn't save"), so
 * Sentry, which only hears of errors nobody caught, never learns of it. Every
 * request to Supabase passes through here, so this is the one place that can
 * tell, whatever the page then does with the answer.
 *
 * Only failures that mean something is broken are reported. The database
 * says no on purpose all the time, and those answers are the app working:
 *
 * - a function's own refusal (`raise exception`: 22023 bad input, 42501 not
 *   allowed, P0002 not found, a duplicate the page turns into a message);
 * - a wrong password or an expired sign-in (anything from `/auth/v1` short of
 *   a server error, and every 401);
 * - `.single()` finding no row (PGRST116), a page past the end (PGRST103).
 *
 * PostgREST answers some of those refusals with HTTP 500 (a function's own
 * 40001 "somebody else closed it", 55000 "already has a location", 54000 "too
 * many in an hour"), so a server error carrying one of those codes is a
 * refusal too.
 *
 * What is reported: a server error from any part of Supabase; a request the
 * schema does not match (PGRST1xx/2xx: a column, table or function the code
 * expects and the database has not got); an error only Postgres itself raises
 * (a missing column, a broken foreign key, a timeout); and row-level security
 * refusing a signed-in person, which on a page they can open is a policy or a
 * page that is wrong.
 *
 * What goes to Sentry is the table or function, the code and the database's
 * sentence; never the query string, the body or `details`, which carry the
 * values.
 */

export type SupabaseFailure = {
  /** "database", "files", "sign-in", "function" or "supabase". */
  service: string;
  method: string;
  /** The table, `rpc/<function>`, `object/<bucket>` or endpoint; never ids or file names. */
  resource: string;
  status: number;
  /** The PostgREST or Postgres code, when the answer had one. */
  code: string;
  message: string;
};

/** Postgres codes only the engine raises, never a function's own `raise`. */
const ENGINE_CODES = new Set(["23502", "23503", "22P02", "22001", "57014"]);
/** Whole classes: 42 (bad SQL, apart from 42501), 08 (connection), 53 (resources), XX (internal). */
const ENGINE_CLASSES = ["42", "08", "53", "XX"];
/** Codes our functions raise on purpose that PostgREST still answers with a 5xx. */
const REFUSALS_AS_SERVER_ERRORS = new Set(["40001", "54000", "55000", "P0001"]);
/** Storage words that come before the bucket: `/object/sign/<bucket>/…`. */
const STORAGE_VERBS = new Set(["sign", "list", "public", "authenticated", "upload", "info", "move", "copy"]);
/** PostgREST codes that are the app working, not failing. */
const EXPECTED_POSTGREST = new Set(["PGRST103", "PGRST116"]);
/** The engine's own wording for a refusal; a function's 42501 says something else. */
const ENGINE_REFUSAL = /row-level security|permission denied for/i;

const SERVICES: Record<string, string> = {
  rest: "database",
  storage: "files",
  auth: "sign-in",
  functions: "function",
};

/**
 * The failure to report for an answer, or null when it is not one. `body` is
 * the answer's JSON, or null when it had none.
 */
export function failureOf(url: string, method: string, status: number, body: unknown): SupabaseFailure | null {
  if (status < 400 || status === 401) return null;
  let path: string[];
  try {
    path = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  // /rest/v1/orders, /storage/v1/object/<bucket>/<path>, /auth/v1/token …
  const service = SERVICES[path[0]] ?? "supabase";
  const rest = path.slice(2);
  const resource =
    service === "files"
      ? [rest[0], rest.slice(1).find((part) => !STORAGE_VERBS.has(part))].filter(Boolean).join("/")
      : (rest[0] === "rpc" ? rest.slice(0, 2) : rest.slice(0, 1)).join("/");

  const answer = (body && typeof body === "object" ? body : {}) as { code?: unknown; message?: unknown };
  const code = typeof answer.code === "string" ? answer.code : "";
  // A data error (22xxx) ends with the value that was refused: `invalid input
  // syntax for type uuid: "…"`. Keep the sentence, not what was typed.
  const said = typeof answer.message === "string" ? answer.message : "";
  const message = (code.startsWith("22") ? said.split(": ")[0] : said).slice(0, 300);
  const failure = { service, method: method.toUpperCase(), resource, status, code, message };

  if (status >= 500) return REFUSALS_AS_SERVER_ERRORS.has(code) ? null : failure;
  if (service === "sign-in" || service === "function") return null;
  if (ENGINE_REFUSAL.test(message)) return failure;
  if (/^PGRST[12]\d\d$/.test(code)) return EXPECTED_POSTGREST.has(code) ? null : failure;
  if (ENGINE_CODES.has(code)) return failure;
  if (code !== "42501" && ENGINE_CLASSES.some((c) => code.startsWith(c))) return failure;
  return null;
}

/**
 * `baseFetch` that hands each failure above to `report`. Reporting never
 * changes the answer and never throws: the caller gets exactly what it would
 * have had.
 */
export function withFailureReport(
  baseFetch: Fetch,
  report: (failure: SupabaseFailure) => void = reportSupabaseFailure
): Fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status >= 400 && response.status !== 401) {
      try {
        const isRequest = typeof Request !== "undefined" && input instanceof Request;
        const url = isRequest ? input.url : String(input);
        const method = init?.method ?? (isRequest ? input.method : "GET");
        const failure = failureOf(url, method, response.status, await readJson(response));
        if (failure) report(failure);
      } catch {
        // A failure to report must not become a second failure.
      }
    }
    return response;
  };
}

/** Read from a copy, so the caller can still read the answer itself. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

/** Looks up the global `fetch` on each call, so Next's and Sentry's wrappers still apply. */
export const supabaseFetch: Fetch = withFailureReport(withSkewRetry((input, init) => fetch(input, init)));
