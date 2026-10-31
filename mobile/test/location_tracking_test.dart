import 'package:flutter/foundation.dart' show TargetPlatform;
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
    test('a foreground service keeps the trail running on Android', () {
      // Asserting `isNotNull` alone would be worthless: it passes for any
      // settings object at all, so deleting the foreground service — the
      // whole substance of the trail — would not fail a test. The service
      // config itself is what has to be pinned.
      final android =
          LocationTracking.settingsFor(platform: TargetPlatform.android)
              as AndroidSettings;
      expect(
        android.foregroundNotificationConfig,
        isNotNull,
        reason:
            'Without this the sampling stops the moment Android backgrounds the '
            'app, which is the 3.6% delivery rate the trail exists to fix. It '
            'is attached for "while using the app" too: started with the app '
            'open, the service keeps that access until the day ends.',
      );
      // Persistent and wake-locked, or the trail arrives in one batch and reads
      // as a rep who teleported.
      expect(android.foregroundNotificationConfig!.setOngoing, isTrue);
      expect(android.foregroundNotificationConfig!.enableWakeLock, isTrue);
    });

    test('an iPhone keeps recording behind other apps, and shows it', () {
      final ios = LocationTracking.settingsFor(platform: TargetPlatform.iOS)
          as AppleSettings;
      expect(ios.allowBackgroundLocationUpdates, isTrue);
      // The blue pill: the rep can see that the phone is recording.
      expect(ios.showBackgroundLocationIndicator, isTrue);
      // Paused updates go quiet in a shop, which reads as a dead phone.
      expect(ios.pauseLocationUpdatesAutomatically, isFalse);
      // No time interval on iOS: without a distance filter it reports about
      // once a second while driving, all day.
      expect(ios.distanceFilter, kIosTrackingDistanceFilterM);
      expect(ios.distanceFilter, greaterThan(0));
    });

    test('no stream is offered when nothing is permitted', () {
      expect(LocationTracking.stream(LocationTrackingMode.unavailable), isNull);
    });

    test('sampling is governed by time, not by movement', () {
      // Zero on purpose. A distance filter goes silent exactly when a rep is
      // standing in a shop, and on the dashboard's map that silence is
      // indistinguishable from a dead battery. Anything above zero here would
      // quietly turn the live map back into a trail.
      expect(kTrackingDistanceFilterM, 0);
    });
  });

  group('odometerLegMeters', () {
    test('jitter does not become mileage', () {
      // The distance filter used to absorb this implicitly: nothing under 75 m
      // was reported, so nothing under 75 m could be added up. Sampling on time
      // means a phone on a counter reports every five minutes, each fix metres
      // from the last, and mileage is what a rep's driving is judged on.
      expect(odometerLegMeters(0), 0);
      expect(odometerLegMeters(12.4), 0);
      expect(odometerLegMeters(kOdometerFloorM - 0.1), 0);
    });

    test('a real leg is counted in full, not scaled', () {
      // A gate, not a scale — shrinking a genuine leg would be its own error.
      expect(odometerLegMeters(kOdometerFloorM.toDouble()), kOdometerFloorM);
      expect(odometerLegMeters(1200), 1200);
    });

    test('a nonsense reading contributes nothing', () {
      expect(odometerLegMeters(double.nan), 0);
      expect(odometerLegMeters(double.infinity), 0);
      expect(odometerLegMeters(-5), 0);
    });
  });
}
