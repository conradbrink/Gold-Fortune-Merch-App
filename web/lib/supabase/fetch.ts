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
    return baseFetch(input, init);
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

/** Looks up the global `fetch` on each call, so Next's and Sentry's wrappers still apply. */
export const supabaseFetch: Fetch = withSkewRetry((input, init) => fetch(input, init));
