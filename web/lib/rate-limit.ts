import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side rate limiting for the routes that reach a paid third party.
 *
 * Counting happens in Postgres, not here. A Next.js route handler is not a
 * reliable place to keep a counter — instances come and go, several run at
 * once, and an in-memory tally resets on every cold start. The database has
 * one row per (bucket, caller, window) and increments it atomically, so two
 * simultaneous requests cannot both read "9 of 10" and both proceed.
 *
 * The caller's identity comes from their session inside `consume_rate_limit`,
 * never from anything the request supplies.
 */

export type Limit = {
  bucket: string;
  /** Units allowed per window. */
  limit: number;
  windowSeconds: number;
};

/**
 * The limits, in one place so they can be read at a glance and tuned without
 * hunting through handlers.
 *
 * Sized against what the work actually looks like rather than plucked from the
 * air: a full estate re-geocode is 209 stores, so an hour's budget of 250
 * covers the largest legitimate run with room to retry, while a rep looping the
 * endpoint stops within seconds. Insights is a long prompt over the whole
 * estate — a manager might reasonably run half a dozen while comparing periods,
 * never sixty.
 */
export const LIMITS = {
  /** Google Places + Geocoding. Charged per store, so the cost is the store count. */
  geocode: { bucket: "geocode", limit: 250, windowSeconds: 3600 },
  /** OpenAI gpt-5.5, one long completion per call. */
  insights: { bucket: "insights", limit: 20, windowSeconds: 3600 },
  /** Creates an auth user. Abuse here pollutes the org and sends mail. */
  repInvite: { bucket: "rep_invite", limit: 10, windowSeconds: 3600 },
  /** Deactivating or deleting a rep. Cheap, but worth a ceiling. */
  repAdmin: { bucket: "rep_admin", limit: 60, windowSeconds: 3600 },
} satisfies Record<string, Limit>;

type Verdict =
  | { ok: true }
  | { ok: false; response: Response };

/**
 * Consumes quota and, when exhausted, returns the 429 to hand straight back.
 *
 * [cost] is for endpoints whose price scales with the request — geocoding 25
 * stores costs 25, not 1. Charged **before** the work happens, so an
 * expensive call cannot slip through while the counter is still being written.
 *
 * A failure inside the limiter does **not** block the request. Losing the
 * ability to count is a worse reason to take the product down than to let a
 * handful of calls through un-counted; the failure is logged instead.
 */
export async function enforceRateLimit(
  supabase: SupabaseClient,
  limit: Limit,
  cost = 1
): Promise<Verdict> {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_bucket: limit.bucket,
    p_limit: limit.limit,
    p_window_seconds: limit.windowSeconds,
    p_cost: cost,
  });

  if (error) {
    console.error(
      `[rate-limit] ${limit.bucket} could not be counted: ${error.message}`
    );
    return { ok: true };
  }

  const verdict = data as {
    allowed: boolean;
    remaining: number;
    retry_after_seconds: number;
  };

  if (verdict.allowed) return { ok: true };

  const retryAfter = Math.max(verdict.retry_after_seconds, 1);
  // Logged as a security event: a burst here is either a runaway client or
  // somebody probing what the endpoint costs.
  console.warn(
    `[rate-limit] ${limit.bucket} exhausted, ${retryAfter}s remaining in window`
  );

  return {
    ok: false,
    response: Response.json(
      {
        error:
          "You have made too many of these requests. Try again shortly.",
        retry_after_seconds: retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    ),
  };
}
