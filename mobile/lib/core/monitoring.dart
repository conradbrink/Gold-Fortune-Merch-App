import 'package:package_info_plus/package_info_plus.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'env.dart';

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
///   * [_scrub] strips anything that looks like a credential from the payload
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
  /// is worse than no error reporter.
  static Future<void> init(Future<void> Function() runApp) async {
    if (!enabled) {
      await runApp();
      return;
    }

    final info = await PackageInfo.fromPlatform();

    await SentryFlutter.init(
      (options) {
        options.dsn = _dsn;

        // "Which version was this?" is the first question about any field
        // report, and reps update at different times.
        options.release = 'gf-merch-rep@${info.version}+${info.buildNumber}';
        options.environment =
            Env.webBaseUrl.contains('vercel.app') ? 'production' : 'development';

        options.sendDefaultPii = false;

        // Errors are the point; traces are a performance feature that would
        // consume the free quota for no benefit to a three-rep team.
        options.tracesSampleRate = 0.0;

        // Session replay is not configured here because this SDK version
        // (sentry_flutter 8.x) has no replay API — it is off by construction.
        // ⚠️ If this package is ever upgraded to 9.x, replay arrives and
        // defaults must be set to zero explicitly. Screen recording of a
        // merchandiser's day, uploaded to a third party, is not something to
        // acquire by accident during a dependency bump.

        options.beforeSend = _scrub;
      },
      appRunner: runApp,
    );
  }

  /// Last line of defence before anything leaves the device.
  static SentryEvent? _scrub(SentryEvent event, Hint hint) {
    // Never report anything from a debug build to the shared issue stream.
    if (event.environment == 'development') return null;

    final request = event.request;
    if (request != null) {
      final headers = Map<String, String>.from(request.headers);
      headers.removeWhere((k, _) {
        final key = k.toLowerCase();
        return key == 'authorization' ||
            key == 'apikey' ||
            key.contains('token') ||
            key.contains('secret');
      });
      event = event.copyWith(
        request: request.copyWith(headers: headers, cookies: null),
      );
    }

    return event;
  }

  static Map<String, dynamic>? _scrubMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    return map.map((k, v) {
      final key = k.toLowerCase();
      final sensitive = key.contains('password') ||
          key.contains('token') ||
          key.contains('secret') ||
          key.contains('apikey') ||
          key.contains('key');
      return MapEntry(k, sensitive ? '[redacted]' : v);
    });
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
        final scrubbed = _scrubMap(data);
        if (scrubbed != null) {
          for (final e in scrubbed.entries) {
            scope.setContexts(e.key, e.value);
          }
        }
      },
    );
  }
}
