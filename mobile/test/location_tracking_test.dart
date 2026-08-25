import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:gf_merch_rep/core/location_tracking.dart';

/// The workday trail's rate limit.
///
/// `distanceFilter` bounds a *stationary* rep, not a moving one — 75 m goes by
/// every four and a half seconds at 60 km/h. This guard is the only thing
/// keeping a drive between towns from writing hundreds of rows an hour into an
/// outbox that has to drain over Botswana mobile data.
void main() {
  final start = DateTime(2026, 8, 24, 8, 0);

  group('shouldRecordPing', () {
    test('the first position of the day is always recorded', () {
      expect(shouldRecordPing(now: start, lastPingAt: null), isTrue);
    });

    test('a position inside the spacing window is dropped', () {
      expect(
        shouldRecordPing(
          now: start.add(const Duration(minutes: 1)),
          lastPingAt: start,
        ),
        isFalse,
      );
    });

    test('a fast-moving rep cannot outrun the limit', () {
      // 75 m at 60 km/h is roughly every 4.5 s. None of these may be written.
      var last = start;
      var written = 0;
      for (var i = 1; i <= 100; i++) {
        final now = start.add(Duration(milliseconds: 4500 * i));
        if (shouldRecordPing(now: now, lastPingAt: last)) {
          written++;
          last = now;
        }
      }
      // 100 stream events across 7.5 minutes — at a 4-minute floor, one write.
      expect(written, 1);
    });

    test('exactly on the boundary is recorded, not dropped', () {
      expect(
        shouldRecordPing(now: start.add(kMinPingSpacing), lastPingAt: start),
        isTrue,
      );
    });

    test('a position past the window is recorded', () {
      expect(
        shouldRecordPing(
          now: start.add(const Duration(minutes: 6)),
          lastPingAt: start,
        ),
        isTrue,
      );
    });

    test('the floor sits below the sampling interval, or it would throttle it', () {
      // If the spacing floor ever exceeded the interval the platform samples at,
      // every second fix would be silently discarded and the trail would quietly
      // halve. Pinned so the two constants cannot drift apart.
      expect(kMinPingSpacing, lessThan(kLocationPingInterval + kMinPingSpacing));
      expect(kMinPingSpacing, lessThanOrEqualTo(kLocationPingInterval));
    });
  });

  group('tracking settings', () {
    test('a foreground service is attached only when it can actually run', () {
      // Asserting `isNotNull` here was worthless: it passed for any settings
      // object at all, so deleting the foreground service — the entire substance
      // of this change — would not have failed a single test. The service config
      // itself is what has to be pinned.
      final background = LocationTracking.settingsFor(
        LocationTrackingMode.background,
      );
      expect(background, isA<AndroidSettings>());
      expect(
        (background as AndroidSettings).foregroundNotificationConfig,
        isNotNull,
        reason:
            'Without this the sampling stops the moment Android backgrounds the '
            'app, which is the 3.6% delivery rate this change exists to fix.',
      );
      // Persistent and wake-locked, or the trail arrives in one batch and reads
      // as a rep who teleported.
      expect(background.foregroundNotificationConfig!.setOngoing, isTrue);
      expect(background.foregroundNotificationConfig!.enableWakeLock, isTrue);

      // Advertising "recording your route" to a rep whose grant stops at
      // "while using the app" would promise tracking that is not happening.
      final foregroundOnly = LocationTracking.settingsFor(
        LocationTrackingMode.foregroundOnly,
      );
      expect(foregroundOnly, isA<AndroidSettings>());
      expect(
        (foregroundOnly as AndroidSettings).foregroundNotificationConfig,
        isNull,
        reason:
            'A permanent notification for tracking that cannot run in the '
            'background is a promise the app does not keep.',
      );
    });

    test('no stream is offered when nothing is permitted', () {
      expect(LocationTracking.stream(LocationTrackingMode.unavailable), isNull);
    });

    test('the distance filter is wide enough not to jitter', () {
      // A medium-accuracy fix wanders tens of metres while the phone sits on a
      // counter. Below about 50 m the trail fills with a stationary rep.
      expect(kTrackingDistanceFilterM, greaterThanOrEqualTo(50));
    });
  });
}
