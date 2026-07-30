// Public Supabase project config. The anon/publishable key is safe to embed
// in client code (mirrors what the web dashboard uses) — real access control
// is enforced entirely by Postgres RLS, not by keeping this secret.
class Env {
  static const supabaseUrl = 'https://bvbgtsxasttjzlemumwy.supabase.co';
  static const supabasePublishableKey =
      'sb_publishable_ul9dGypnoGkwgddxEBVBYQ_Tlao-Lej';

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
  /// ⚠️ The default below is a placeholder until the production domain is
  /// connected. `docs/RELEASE-ANDROID.md` requires the --dart-define on every
  /// release build for exactly this reason: shipping the placeholder gives reps
  /// an update button that goes nowhere.
  static const webBaseUrl = String.fromEnvironment(
    'GF_WEB_BASE_URL',
    defaultValue: 'https://gold-fortune-merch-app.vercel.app',
  );

  static String get downloadPageUrl => '$webBaseUrl/download';
}
