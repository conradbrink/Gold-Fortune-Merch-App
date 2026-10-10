/**
 * Where to go after signing in.
 *
 * Someone who opens a page without a session is sent to /login, and the page
 * they asked for travels with them as `?next=`. Without it, signing in always
 * landed on the dashboard, and the operator, who reaches /platform only by
 * typing it, had to type it again.
 *
 * `next` arrives in a URL anyone can write, so it is read strictly: a path on
 * this site and nothing else. `//evil.example` and `/\evil.example` are both
 * read by browsers as another host, and a full URL is refused outright.
 * Anything doubtful goes home ("/"), which is where signing in went before.
 */

/** The `next` value for a path, or null when there is nothing to return to. */
export function nextParam(pathname: string, search: string): string | null {
  if (pathname === "/" || pathname === "/login") return null;
  return pathname + search;
}

/** A path that is safe to send someone to after sign-in. */
export function returnPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  // Control characters (a tab or newline) are stripped by browsers when they
  // parse a URL, so "/\t/evil.example" would become "//evil.example".
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}
