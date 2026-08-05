import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:sentry_flutter/sentry_flutter.dart';


/// Crash and error reporting.
///
/// Exists because until 31 July 2026 a rep's app could crash in Kasane and
/// nothing anywhere recorded it — the first anyone knew was a phone call. The
/// classes of failure that matter most here are the quiet ones: a photo that
/// never uploaded, a sync that stopped draining, a visit saved locally that
/// never reached the server.
///
/// ## What is deliberately NOT sent
///
/// Reps carry customer and location data, and this ships to a third party.
/// So:
///
///   * `sendDefaultPii = false` — no IP addresses, no device names, no
///     usernames attached automatically.
///   * [scrub] strips anything that looks like a credential from the payload
///     before it leaves the device, including the Supabase key, bearer tokens
///     and anything under a key containing "password", "token" or "secret".
///   * GPS coordinates are never attached as context. Knowing *that* a
///     check-in failed is what helps; knowing exactly where a named person
///     stood at 14:02 is surveillance, and it is not needed to fix a bug.
class Monitoring {
  /// Set from `--dart-define=SENTRY_DSN=…` at build time.
  ///
  /// Empty by default on purpose: a developer build should not post to the
  /// production issue stream, and a fork of this repo should not post to it at
  /// all. When empty, [init] simply runs the app without monitoring.
  static const _dsn = String.fromEnvironment('SENTRY_DSN');

  static bool get enabled => _dsn.isNotEmpty;

  /// Wraps app startup. Falls back to running the app unmonitored if Sentry
  /// cannot start — an error reporter that can prevent the app from launching
  /// is worse than no error reporter, and this promise was previously only in
  /// the comment rather than in the code.
  ///
  /// ⚠️ The caller must have called `WidgetsFlutterBinding.ensureInitialized()`
  /// first: reading the package version uses a platform channel, which does not
  /// exist before the binding is up.
  static Future<void> init(Future<void> Function() runApp) async {
    if (!enabled) {
      await runApp();
      return;
    }

    final PackageInfo info;
    try {
      info = await PackageInfo.fromPlatform();
    } catch (_) {
      // Cannot even identify the build — start the app rather than block it.
      await runApp();
      return;
    }

    try {
      await _start(info, runApp);
    } catch (_) {
      // Sentry failed to initialise. The rep's day matters more than the
      // telemetry; `appRunner` may not have been reached, so run it here.
      await runApp();
    }
  }

  static Future<void> _start(
    PackageInfo info,
    Future<void> Function() runApp,
  ) async {
    await SentryFlutter.init(
      (options) {
        options.dsn = _dsn;

        // "Which version was this?" is the first question about any field
        // report, and reps update at different times.
        options.release = 'gf-merch-rep@${info.version}+${info.buildNumber}';

        // From the build mode, not from a URL. Deriving it from `webBaseUrl`
        // meant a release build pointed at a staging domain would report as
        // "development" and be dropped — losing exactly the reports a staging
        // build exists to produce.
        options.environment = kReleaseMode ? 'production' : 'development';

        options.sendDefaultPii = false;

        // Errors are the point; traces are a performance feature that would
        // consume the free quota for no benefit to a three-rep team.
        options.tracesSampleRate = 0.0;

        // The upgrade to 9.x this warned about has now happened, so replay is
        // turned off by hand rather than by construction. Screen recording of
        // a merchandiser's day, uploaded to a third party, is not something to
        // acquire by accident during a dependency bump — and a rep's screen
        // shows shop names, prices and their own position all day.
        //
        // Both rates, not just the session one: `onErrorSampleRate` records
        // the seconds *before* an error independently, so leaving it at its
        // default would still upload footage from every crash.
        options.replay.sessionSampleRate = 0.0;
        options.replay.onErrorSampleRate = 0.0;

        options.beforeSend = scrub;
      },
      appRunner: runApp,
    );
  }

  /// Last line of defence before anything leaves the device.
  ///
  /// Not private, so it can be tested directly. It is the only thing standing
  /// between a rep's session token and a third party, and it had no coverage
  /// at all until it was rewritten for the 9.x upgrade.
  @visibleForTesting
  static SentryEvent? scrub(SentryEvent event, Hint hint) {
    // Never report anything from a debug build to the shared issue stream.
    if (event.environment == 'development') return null;

    if (_isRetryableNetworkNoise(event)) return null;

    // Mutated in place rather than through `copyWith`, which 9.x deprecated.
    //
    // One deliberate difference from the version this replaced: `queryString`
    // is cleared whenever there is a request, not only when the URL happens to
    // contain a `?`. It is a separate field and can carry parameters the URL
    // does not, so the old condition left a way through.
    final request = event.request;
    if (request != null) {
      final headers = Map<String, String>.from(request.headers);
      headers.removeWhere((k, _) => _isSensitiveHeader(k));
      request.headers = headers;
      request.cookies = null;

      // A query string carries recovery and access tokens on auth redirects.
      // The path is what helps debugging; the parameters never are.
      final url = request.url;
      if (url != null && url.contains('?')) {
        request.url = url.split('?').first;
      }
      request.queryString = null;
    }

    return event;
  }

  /// A token refresh that failed for want of a network, and will be retried.
  ///
  /// Reported as **fatal** and unhandled, which is neither: gotrue's auto
  /// refresh runs on a timer with nobody to catch it, so the exception reaches
  /// `PlatformDispatcher.onError` and Sentry files a crash for a rep driving
  /// through a gap in the coverage. Ten of these came off one handset in two
  /// days (FLUTTER-1) while the failure that actually stopped the field team —
  /// every order arriving with no lines on it — sat one row below them.
  ///
  /// Dropped rather than downgraded. It is retryable by construction and the
  /// SDK retries it; there is no version of this event anyone acts on. A
  /// refresh that genuinely cannot recover arrives as a *non*-retryable
  /// `AuthApiException`, which still comes through — that one means a rep is
  /// about to be signed out, and is worth knowing about.
  ///
  /// Matched on the type name rather than the class so this file keeps no
  /// dependency on gotrue, and so it can be tested without one.
  static bool _isRetryableNetworkNoise(SentryEvent event) {
    for (final exception in event.exceptions ?? const <SentryException>[]) {
      if (exception.type == 'AuthRetryableFetchException') return true;
    }
    return false;
  }

  /// Whether a *header* carries a credential.
  ///
  /// The name is normalised — lowercased, and punctuation removed — before
  /// matching, because header names are spelled inconsistently and an exact
  /// comparison missed two real ones: `X-Api-Key` is not the literal `apikey`,
  /// and `Cookie` is a header in its own right, quite separate from
  /// `SentryRequest.cookies`. Both were passing straight through.
  static bool _isSensitiveHeader(String name) {
    final k = name.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
    return k.contains('authorization') ||
        k.contains('apikey') ||
        k.contains('token') ||
        k.contains('secret') ||
        k.contains('cookie') ||
        k.contains('password') ||
        k.contains('session');
  }

  static bool _isSensitiveKey(String key) {
    final k = key.toLowerCase();
    return k.contains('password') ||
        k.contains('token') ||
        k.contains('secret') ||
        k.contains('apikey') ||
        k.contains('api_key') ||
        k.contains('authorization') ||
        k.contains('key');
  }

  /// Redacts sensitive keys **at every depth**.
  ///
  /// A shallow pass looked right and was not: a payload is nested, so
  /// `{'body': {'access_token': …}}` sailed straight through the top-level
  /// check. Lists are walked too, because a batch is a list of maps.
  static Object? _scrubValue(Object? value) {
    if (value is Map) {
      return value.map<String, Object?>((k, v) {
        final key = k.toString();
        return MapEntry(key, _isSensitiveKey(key) ? '[redacted]' : _scrubValue(v));
      });
    }
    if (value is List) return value.map(_scrubValue).toList();
    return value;
  }

  static Map<String, dynamic>? _scrubMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    return Map<String, dynamic>.from(_scrubValue(map) as Map);
  }

  /// Records a business event as a breadcrumb.
  ///
  /// Breadcrumbs are attached to whatever error comes *next*, which is what
  /// makes "the sync failed" answerable — you can see the rep checked in, took
  /// two photos, went offline, and then it broke.
  ///
  /// ⚠️ Pass identifiers and counts, never content. A store id is fine; a
  /// customer name or a GPS fix is not.
  static void event(String name, {Map<String, dynamic>? data}) {
    if (!enabled) return;
    Sentry.addBreadcrumb(Breadcrumb(
      category: 'business',
      message: name,
      level: SentryLevel.info,
      data: _scrubMap(data),
    ));
  }

  /// Reports a caught error that the app handled but a human should see —
  /// a sync that gave up, an upload that will not retry.
  static Future<void> report(
    Object error,
    StackTrace stack, {
    String? feature,
    Map<String, dynamic>? data,
  }) async {
    if (!enabled) return;
    await Sentry.captureException(
      error,
      stackTrace: stack,
      withScope: (scope) {
        if (feature != null) scope.setTag('feature', feature);
        // One named context, not one per key. Setting a context per key
        // floods the issue with single-value blocks and can collide with
        // Sentry's own reserved context names.
        final scrubbed = _scrubMap(data);
        if (scrubbed != null && scrubbed.isNotEmpty) {
          scope.setContexts('operation', scrubbed);
        }
      },
    );
  }
}
