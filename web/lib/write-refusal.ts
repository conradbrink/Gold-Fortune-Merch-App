/**
 * A refused write, in one sentence a person can act on.
 *
 * The database says no in its own words: the billing gate's "read-only until
 * the plan is paid", a module's "is not enabled for your company's plan",
 * row-level security's "new row violates row-level security policy", and the
 * lib functions' own "you may not have permission" when an update or delete
 * that RLS filtered away changed no rows. The first two are already plain, so
 * they pass through; the rest become one sentence. Anything else is null, for
 * the caller to log and answer generally.
 */
export function writeRefusal(reason: unknown): string | null {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/read-only until the plan is paid/i.test(message)) return "Your account is read-only until the plan is paid.";
  if (/is not enabled for your company's plan/i.test(message)) return message.trim().replace(/\.?$/, ".");
  if (/row-level security|permission denied|42501|you may not have permission/i.test(message)) {
    return "Your access in Tickd doesn't let you change that.";
  }
  if (/changed since|reload and try again/i.test(message)) {
    return "It changed since this was drafted. Ask the AI Manager again.";
  }
  return null;
}
