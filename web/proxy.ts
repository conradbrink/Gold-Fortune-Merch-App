import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  homeFor,
  matchesPrefix,
  toPermissionSet,
} from "@/lib/permissions";

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

  // Segment-aware, like every other prefix test in this file. A bare
  // `startsWith` would match /login-as-someone-else, and this list is the one
  // place where a wrong match *grants* access rather than denying it: an
  // exemption skips the role check entirely.
  const isLoginPage = matchesPrefix(request.nextUrl.pathname, "/login");
  const isRepNoticePage = matchesPrefix(request.nextUrl.pathname, "/rep-notice");

  // The APK download page is public, and has to be.
  //
  // A rep setting up a new handset cannot sign in to get the app, because
  // signing in is what the app is for. Gating this page behind the session
  // would make first-time installation impossible. Nothing on it is sensitive:
  // an app name, a version, a size and a changelog. The APK bytes are served by
  // a separate route from a private bucket.
  const isDownloadPage = matchesPrefix(request.nextUrl.pathname, "/download");

  // The password-reset pair.
  //
  // /forgot-password is reached with no session, by definition. /reset-password
  // *does* carry one — the emailed link establishes a recovery session — which
  // is why it also has to be exempt from the rep redirect below: a rep who
  // forgot their password would otherwise be bounced to /rep-notice before they
  // could set a new one, with no way through.
  const isPasswordResetPage =
    matchesPrefix(request.nextUrl.pathname, "/forgot-password") ||
    matchesPrefix(request.nextUrl.pathname, "/reset-password");

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
  // This has been narrowed twice. It first asked "is this person a rep?" and
  // bounced them — a denylist with an open default, which broke the moment a
  // third role existed. Then it was an allowlist per role, which broke the
  // moment somebody needed two roles' worth of access and there was no role for
  // them. It now asks which permissions the person holds, and every path names
  // the one it needs; a page added tomorrow with no entry in that map is
  // refused until somebody decides who it belongs to.
  if (
    user &&
    !isRepNoticePage &&
    !isLoginPage &&
    !isDownloadPage &&
    !isPasswordResetPage
  ) {
    // One round trip, as before — it used to fetch `profiles.role`. Asking the
    // database for the permission set rather than deriving it here keeps the
    // proxy and RLS reading the same answer from the same place.
    const { data: granted, error: permissionError } = await supabase.rpc(
      "my_permissions"
    );

    // A query that failed is not the same fact as a person with no
    // permissions. Falling through to "nothing" on a timeout would strand an
    // administrator on /rep-notice looking like a broken account, and the one
    // thing they could not work out is that it was temporary.
    if (permissionError) {
      return new NextResponse(
        "Could not check your access just now. Reload in a moment.",
        { status: 503 }
      );
    }

    // An empty set is a real answer: a signed-in user whose profile was never
    // provisioned. They get the notice page, which is a dead end rather than a
    // redirect loop.
    const permissions = toPermissionSet(granted as string[] | null);

    if (!canAccessPath(permissions, request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = homeFor(permissions);
      // Guard against a home that is itself refused, which would redirect for
      // ever. Only reachable if `homeFor` and the path map ever disagree.
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
