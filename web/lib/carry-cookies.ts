import type { NextResponse } from "next/server";

/**
 * Copies the cookies the proxy has set on `from` onto `to`, and returns `to`.
 *
 * The Supabase client in `proxy.ts` writes the session's cookies onto the
 * response it was given: a refreshed token, or the removal of one the server
 * no longer knows. A redirect is a new response, so without this those
 * cookies were left behind. A browser holding a dead session was sent to
 * /login still holding it, and that request failed the same refresh a second
 * time (Sentry JAVASCRIPT-NEXTJS-5, 31 October 2026: two refusals one second
 * apart from one visit).
 */
export function carryCookies<T extends NextResponse>(from: NextResponse, to: T): T {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}
