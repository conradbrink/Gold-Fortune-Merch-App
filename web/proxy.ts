import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  // Reps are bounced to /rep-notice everywhere except the download page —
  // a signed-in rep fetching a newer APK is the update path working as intended.
  if (
    user &&
    !isRepNoticePage &&
    !isLoginPage &&
    !isDownloadPage &&
    !isPasswordResetPage
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role === "rep") {
      const url = request.nextUrl.clone();
      url.pathname = "/rep-notice";
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
