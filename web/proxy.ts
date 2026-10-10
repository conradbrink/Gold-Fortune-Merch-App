import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canAccessPath,
  homeFor,
  matchesPrefix,
  toPermissionSet,
} from "@/lib/permissions";
import { canReachPath, moduleForPath, toModuleSet } from "@/lib/modules";

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

  // The free-trial sign-up (Stage 5) is public, and has to be: it is where a
  // company comes into being, so nobody arriving there has a login yet. Its
  // server actions limit attempts per address and per email, and build the
  // company in the database in one transaction. Someone already signed in is
  // sent to their own dashboard, as from /login.
  const isSignupPage = matchesPrefix(request.nextUrl.pathname, "/signup");

  // The platform operator's area. A session is still required (it is not in
  // the anonymous list below), but it is exempt from the permission map: that
  // map is about what a person may do inside their own company, and the
  // operator check — `is_platform_admin()` — is made by the page itself on the
  // server, which answers 404 to everyone else.
  const isPlatformPage = matchesPrefix(request.nextUrl.pathname, "/platform");

  // The explanation for a module the company does not have. Exempt from the
  // checks below for the reason /rep-notice is: it is where they send people.
  const isNotEnabledPage = matchesPrefix(request.nextUrl.pathname, "/not-enabled");

  // Pages for a company's own clients (Stage 8): the link in an email, to stop
  // those emails or to see and sign a job's report. The person opening them
  // has no Tickd login, and someone who has one is not asked for it either.
  // Each page checks its own signed token on the server and shows nothing
  // without a valid one.
  const isClientPage = matchesPrefix(request.nextUrl.pathname, "/c");

  if (!user && !isLoginPage && !isDownloadPage && !isPasswordResetPage && !isSignupPage && !isClientPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && (isLoginPage || isSignupPage)) {
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
    !isPasswordResetPage &&
    !isPlatformPage &&
    !isNotEnabledPage &&
    !isClientPage
  ) {
    // Two questions, asked in parallel so the page waits for one round trip:
    // what may this person do, and what has their company got. Both come from
    // the database, so the proxy and RLS read the same answers.
    const ask = () =>
      Promise.all([supabase.rpc("my_permissions"), supabase.rpc("my_company_config")]);
    let [
      { data: granted, error: permissionError },
      { data: config, error: configError },
    ] = await ask();
    // One retry before giving up. Straight after sign-in the new token can be
    // refused for a moment as "JWT issued at future" (PGRST303, clock skew
    // between the auth server and the API), which showed the person the
    // "could not check your access" page on their very first screen.
    if (permissionError || configError) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      [
        { data: granted, error: permissionError },
        { data: config, error: configError },
      ] = await ask();
    }

    // A query that failed is not the same fact as a person with no
    // permissions. Falling through to "nothing" on a timeout would strand an
    // administrator on /rep-notice looking like a broken account, and the one
    // thing they could not work out is that it was temporary.
    if (permissionError || configError) {
      return new NextResponse(
        "Could not check your access just now. Reload in a moment.",
        { status: 503 }
      );
    }

    // An empty set is a real answer: a signed-in user whose profile was never
    // provisioned. They get the notice page, which is a dead end rather than a
    // redirect loop.
    const permissions = toPermissionSet(granted as string[] | null);
    const modules = toModuleSet(
      (config as { modules?: Record<string, unknown> } | null)?.modules
    );

    // The company first: a page of a module it does not have is explained,
    // not bounced. Sending someone "home" from /hr when HR is off would look
    // like a broken link; the notice says why.
    if (!canReachPath(modules, request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/not-enabled";
      url.search = `?module=${moduleForPath(request.nextUrl.pathname)}`;
      return NextResponse.redirect(url);
    }

    if (!canAccessPath(permissions, request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = homeFor(permissions, (href) => canReachPath(modules, href));
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
