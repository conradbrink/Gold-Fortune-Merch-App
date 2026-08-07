// Public Supabase project config. The anon/publishable key is safe to embed
// in client code (mirrors what the web dashboard uses) — real access control
// is enforced entirely by Postgres RLS, not by keeping this secret.
class Env {
  static const supabaseUrl = 'https://rxtlnetlzmbqirqaalkw.supabase.co';
  static const supabasePublishableKey =
      'sb_publishable_BnVfT1ZntkQfCs92JUG6mA_uYEIjl7o';

  /// Base URL of the production web platform.
  ///
  /// Only used to send a rep to the APK download page when an update is
  /// available — no data is exchanged with it.
  ///
  /// Overridable at build time so a release can be pointed at the real domain
  /// without editing source:
  ///
  ///   flutter build apk --release --dart-define=GF_WEB_BASE_URL=https://app.goldfortune.co.bw
  ///
  /// The default is the live Vercel domain, and it is the *deployed* one.
  ///
  /// It used to read `gold-fortune-merch-app.vercel.app`, which 404s — the
  /// project deploys to `…-rnyn.vercel.app`. Anyone who built without the
  /// `--dart-define` shipped reps an update button that went nowhere, and the
  /// only sign of it was a rep saying the download page would not load.
  ///
  /// `docs/RELEASE-ANDROID.md` still requires the flag on every release build,
  /// and should keep requiring it: a custom domain is the eventual answer and
  /// the flag is what makes that a build-time change rather than a code one.
  /// But a default that works is better than a default that cannot.
  static const webBaseUrl = String.fromEnvironment(
    'GF_WEB_BASE_URL',
    defaultValue: 'https://gold-fortune-merch-app-rnyn.vercel.app',
  );

  static String get downloadPageUrl => '$webBaseUrl/download';
}
