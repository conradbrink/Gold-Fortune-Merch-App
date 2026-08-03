import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canAccessPath, ROLE_HOME, type AppRole } from "@/lib/roles";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  const isRepNoticePage = request.nextUrl.pathname.startsWith("/rep-notice");

  // The APK download page is public, and has to be.
  //
  // A rep setting up a new handset cannot sign in to get the app, because
  // signing in is what the app is for. Gating this page behind the session
  // would make first-time installation impossible. Nothing on it is sensitive:
  // an app name, a version, a size and a changelog. The APK bytes are served by
  // a separate route from a private bucket.
  const isDownloadPage = request.nextUrl.pathname.startsWith("/download");

  // The password-reset pair.
  //
  // /forgot-password is reached with no session, by definition. /reset-password
  // *does* carry one — the emailed link establishes a recovery session — which
  // is why it also has to be exempt from the rep redirect below: a rep who
  // forgot their password would otherwise be bounced to /rep-notice before they
  // could set a new one, with no way through.
  const isPasswordResetPage =
    request.nextUrl.pathname.startsWith("/forgot-password") ||
    request.nextUrl.pathname.startsWith("/reset-password");

  if (!user && !isLoginPage && !isDownloadPage && !isPasswordResetPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Every signed-in request is checked against the role's allowlist, except the
  // pages above that have to work regardless — the download page (a signed-in
  // rep fetching a newer APK is the update path working as intended) and the
  // password-reset pair.
  //
  // This used to ask "is this person a rep?" and bounce them to /rep-notice.
  // That was a denylist with an open default, and it broke the moment a third
  // role existed: a warehouse clerk is not a rep, so they fell through to the
  // full manager shell — Reports, Representatives, Territories, Settings. RLS
  // empties those grids and the API routes refuse anyone who is not a manager,
  // so nothing leaked, but the clerk was handed a menu of pages that render
  // blank. `canAccessPath` inverts it: permitted paths are named, and a role
  // nobody has thought about yet is locked out rather than let in.
  if (
    user &&
    !isRepNoticePage &&
    !isLoginPage &&
    !isDownloadPage &&
    !isPasswordResetPage
  ) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    // A query that failed is not the same fact as a profile that is missing.
    // Falling through to the `rep` default on a timeout or an RLS change would
    // strand a manager on /rep-notice looking like a broken account, and the
    // one thing they could not work out is that it was temporary. PGRST116 is
    // "no rows", which genuinely is a broken account and is handled below.
    if (profileError && profileError.code !== "PGRST116") {
      return new NextResponse(
        "Could not check your access just now. Reload in a moment.",
        { status: 503 }
      );
    }

    const role = profile?.role as AppRole | undefined;

    // No profile row, or a role this build does not know about. Treated as a
    // rep, which is the least-privileged destination and a dead end rather than
    // a redirect loop. A signed-in user with no profile is a broken account,
    // not a manager.
    const effectiveRole: AppRole =
      role === "manager" || role === "warehouse" || role === "rep"
        ? role
        : "rep";

    if (!canAccessPath(effectiveRole, request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = ROLE_HOME[effectiveRole];
      // Guard against a home that is itself refused, which would redirect for
      // ever. Only reachable if ROLE_HOME and the allowlist ever disagree.
      if (url.pathname === request.nextUrl.pathname) return response;
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    // `api` is excluded deliberately. Redirects default to 307, which preserves
    // the method, so a rep POSTing to an API route would have the POST replayed
    // against /rep-notice — fetch follows it, res.ok is true, and res.json()
    // then throws a parse error on HTML. Route handlers authenticate themselves
    // and return a real 401 instead.
    "/((?!api|_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
