// Public Supabase project config. The anon/publishable key is safe to embed
// in client code (mirrors what the web dashboard uses) — real access control
// is enforced entirely by Postgres RLS, not by keeping this secret.
class Env {
  static const supabaseUrl = 'https://rxtlnetlzmbqirqaalkw.supabase.co';
  static const supabasePublishableKey =
      'sb_publishable_BnVfT1ZntkQfCs92JUG6mA_uYEIjl7o';

  /// Base URL of the production web platform.
  ///
  /// Used to send a rep to the APK download page when an update is available,
  /// and to plan a driver's route.
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

  /// True in the Google Play build (`--dart-define=TICKD_STORE=play`).
  ///
  /// A constant so that [downloadPageUrl] is emptied when the Play build is
  /// compiled: that build then carries no link to the download page at all,
  /// rather than one that is merely never followed. Google Play removes an
  /// app that installs updates it did not deliver (core/distribution.dart).
  static const playBuild = String.fromEnvironment('TICKD_STORE') == 'play';

  /// The App Store's number for Tickd (the `id…` in its App Store link). It
  /// exists once the app is created in App Store Connect, before the first
  /// upload, so every iPhone release build passes it:
  /// `--dart-define=TICKD_APP_STORE_ID=<number>`.
  static const appStoreId = String.fromEnvironment('TICKD_APP_STORE_ID');

  /// The APK download page. Empty in the Play build ([playBuild]).
  static const downloadPageUrl = playBuild ? '' : '$webBaseUrl/download';

  /// The public website, which is not the web platform above.
  static const siteUrl = 'https://tickd.co.za';

  /// How to delete a login. Both stores ask for this page, and the home
  /// screen's menu links to it (shared/widgets/account_menu.dart).
  static const deleteAccountUrl = '$siteUrl/delete-account';

  /// The privacy policy. Both stores want it reachable from inside the app as
  /// well as from the listing, so the home screen's menu links to it too.
  static const privacyPolicyUrl = '$siteUrl/privacy';
}
