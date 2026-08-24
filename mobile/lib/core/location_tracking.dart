/// Continuous location tracking for an open workday.
///
/// ## Why this exists
///
/// The workday trail used to be a plain `Timer.periodic` in the Dart isolate.
/// A Dart timer lives and dies with the process, and Android suspends or kills a
/// backgrounded app — so the timer only ticked while a rep happened to be
/// holding the phone with the app in front. Measured against production on
/// 24 August 2026, over the 23 workday sessions of a plausible length:
///
/// ```
/// interval pings expected at 20 min : 549
/// actually recorded                 :  20   (3.6%)
/// sessions with zero interval pings :  14 of 23
/// ```
///
/// Shortening the interval would have multiplied a timer that was not running.
/// The fix is to let the platform do the sampling, through a location stream
/// backed by a foreground service.
///
/// ## What this does NOT promise
///
/// geolocator's own documentation is blunt about the limit, and it is worth
/// repeating rather than discovering later:
///
/// > Using this foreground notification does not run your service in the
/// > background, it just increases the priority of your activity making it less
/// > likely for Android to kill the activity when switching between apps. It
/// > does not prevent Android from killing the activity.
///
/// So this is a large improvement, not a guarantee — especially on the 1 GB
/// SM-A013G that already shows up in Sentry dying to memory pressure, and on
/// Samsung builds where "Put unused apps to sleep" will stop it anyway. The
/// delivery rate has to be **measured in the field** after this ships; if it is
/// still poor, the next step is a true background isolate, which is a different
/// and much heavier piece of work.
library;

import 'package:geolocator/geolocator.dart';

/// How often the platform is asked for a position while a workday is open.
///
/// The owner asked for five minutes. Note that this is a *ceiling on frequency*,
/// not a promise of one fix every five minutes: [kTrackingDistanceFilterM] means
/// a stationary rep produces nothing at all.
const kLocationPingInterval = Duration(minutes: 5);

/// Metres a rep must move before the platform reports a new position.
///
/// This is the single most useful setting in the file, for battery *and* for
/// data quality. A rep spends 20–40 minutes inside a store; without a distance
/// filter that is eight identical points, each one costing a fix. With it, the
/// trail records movement and nothing else.
///
/// 75 m is comfortably outside the noise of a medium-accuracy fix, so a phone
/// sitting on a counter does not jitter its way into a stream of pings.
const kTrackingDistanceFilterM = 75;

/// Floor on the spacing between two recorded pings, whatever the stream does.
///
/// `distanceFilter` alone is not a rate limit: a rep driving at 60 km/h clears
/// 75 m every four and a half seconds, which would be hundreds of rows an hour
/// and an outbox that never drains on a bad connection. This is the guard that
/// makes the write rate predictable regardless of speed.
const kMinPingSpacing = Duration(minutes: 4);

/// Whether a position arriving now should be written as a ping.
///
/// Pulled out of the controller so it can be tested without a platform channel.
/// The comparison is `>=` rather than `>`: a stream that delivers exactly on the
/// boundary is the expected case, not an edge case to drop.
bool shouldRecordPing({required DateTime now, DateTime? lastPingAt}) {
  if (lastPingAt == null) return true;
  return now.difference(lastPingAt) >= kMinPingSpacing;
}

/// What tracking we are actually able to do, given what the rep has granted.
enum LocationTrackingMode {
  /// "Allow all the time" — the stream runs with a foreground service.
  background,

  /// "While using the app" — the stream still runs, but Android stops it once
  /// the app is not visible. Better than nothing, and honest about being partial.
  foregroundOnly,

  /// Denied, or location services are off. No trail at all.
  unavailable,
}

class LocationTracking {
  /// Works out how much tracking this rep has permitted.
  ///
  /// Deliberately never *asks* for background permission here. On Android 11 and
  /// later the "Allow all the time" option cannot be granted from an in-app
  /// prompt at all — the request silently returns the same `whileInUse` and the
  /// only route is the system settings page. Asking and being refused by the
  /// platform, with no dialog shown, looks like a broken button. The UI explains
  /// and links to settings instead; this call only reports the current state.
  static Future<LocationTrackingMode> currentMode() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationTrackingMode.unavailable;
    }
    final permission = await Geolocator.checkPermission();
    switch (permission) {
      case LocationPermission.always:
        return LocationTrackingMode.background;
      case LocationPermission.whileInUse:
        return LocationTrackingMode.foregroundOnly;
      case LocationPermission.denied:
      case LocationPermission.deniedForever:
      case LocationPermission.unableToDetermine:
        return LocationTrackingMode.unavailable;
    }
  }

  /// Settings for the workday trail.
  ///
  /// **Accuracy is `medium` on purpose, and it is the biggest battery lever in
  /// the app.** `high` drives the GPS chip; `medium` lets Android answer from
  /// fused Wi-Fi and cell positioning, waking the GPS receiver far less often.
  /// The question this trail answers is "which town, which road, which shop" at
  /// a scale of hundreds of metres — roughly 100 m is ample. Check-in and
  /// check-out keep `LocationAccuracy.high` in [LocationService], because those
  /// are measured against a store geofence and a sloppy fix there is a wrong
  /// answer rather than a coarse one.
  static LocationSettings settingsFor(LocationTrackingMode mode) {
    return AndroidSettings(
      accuracy: LocationAccuracy.medium,
      distanceFilter: kTrackingDistanceFilterM,
      intervalDuration: kLocationPingInterval,
      // Only attach the foreground service when it can actually help. Showing a
      // permanent notification to a rep whose grant stops at "while using the
      // app" would advertise tracking that is not happening.
      foregroundNotificationConfig: mode == LocationTrackingMode.background
          ? const ForegroundNotificationConfig(
              notificationTitle: 'Workday in progress',
              notificationText:
                  'Gold Fortune is recording your route until you end the day.',
              notificationChannelName: 'Workday tracking',
              // Persistent: a rep swiping the notification away would stop the
              // service and silently lose the rest of the day's trail.
              setOngoing: true,
              // Without the wake lock the device sleeps and Android delivers the
              // whole batch at once when it next wakes — which reads as a rep who
              // teleported, and is the failure this class exists to remove.
              enableWakeLock: true,
            )
          : null,
    );
  }

  /// The position stream for an open workday, or null when nothing is permitted.
  static Stream<Position>? stream(LocationTrackingMode mode) {
    if (mode == LocationTrackingMode.unavailable) return null;
    return Geolocator.getPositionStream(
      locationSettings: settingsFor(mode),
    );
  }

  /// Opens the system page where "Allow all the time" can be granted.
  static Future<bool> openPermissionSettings() =>
      Geolocator.openAppSettings();
}
