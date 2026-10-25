/**
 * A refused write, in one sentence a person can act on.
 *
 * The database says why it refused in its error's code and hint, not only in
 * its words. The cases:
 *
 * - the billing gate raises 42501 with hint `read_only`;
 * - a module's gate raises 42501 with hint `module:<code>`;
 * - row-level security raises 42501;
 * - an impossible date raises 22008.
 *
 * `dbError` keeps the code and hint on the thrown error, where a plain
 * `new Error(error.message)` drops them. The lib writes mark their own refusals
 * the same way: `stale` when the row changed since it was shown, `not_written`
 * when RLS filtered the write away. So `writeRefusal` reads the reason, not the
 * sentence, and a reworded message can't move a refusal into the wrong one.
 * Anything it doesn't know is null, for the caller to log and answer
 * generally.
 */

export type DbError = Error & { code?: string; hint?: string };

/** An error from PostgREST, kept with its code and hint. */
export function dbError(error: { message: string; code?: string | null; hint?: string | null }): DbError {
  return Object.assign(new Error(error.message), {
    code: error.code ?? undefined,
    hint: error.hint ?? undefined,
  });
}

/**
 * One of the lib's own refusals: the row changed since it was shown (`stale`),
 * the write reached nothing (`not_written`), or it stopped part-way in a state
 * its own words describe (`partial`), which must not simply be tried again.
 */
export function refused(message: string, hint: "stale" | "not_written" | "partial"): DbError {
  return Object.assign(new Error(message), { hint });
}

export function writeRefusal(reason: unknown): string | null {
  const e = (reason ?? {}) as { message?: unknown; code?: unknown; hint?: unknown };
  const message = typeof e.message === "string" ? e.message : String(reason ?? "");
  const hint = typeof e.hint === "string" ? e.hint : "";
  const code = typeof e.code === "string" ? e.code : "";

  if (hint === "read_only") return "Your account is read-only until the plan is paid. Open Billing to choose a plan.";
  if (hint.startsWith("module:")) return message.trim().replace(/\.?$/, ".");
  if (hint === "stale") return "It changed since this was drafted. Ask the AI Manager again.";
  if (hint === "partial") return message;
  if (hint === "not_written" || code === "42501" || /row-level security/i.test(message)) {
    return "Your access in Tickd doesn't let you change that.";
  }
  if (code === "22008" || code === "22007") return "One of the dates isn't a real day.";
  return null;
}
