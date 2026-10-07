import 'dart:async';

import 'package:geolocator/geolocator.dart';

class LocationDeniedException implements Exception {
  final String message;
  const LocationDeniedException(this.message);
  @override
  String toString() => message;
}

/// Only a fix older than allowed was available. A [LocationDeniedException], so
/// every caller that already shows those messages shows this one too.
class StaleFixException extends LocationDeniedException {
  const StaleFixException(super.message);
}

/// The worst fix accepted when a rep sets a store's location.
///
/// Half the default geofence, so a store located at the limit still leaves a
/// check-in comfortably inside its own fence. Check-in and check-out are never
/// refused — a rep must never be stranded at a store (a check-in with only an
/// old fix records no position instead) — but this writes a coordinate that
/// everything afterwards is measured against, so it is the one place worth
/// refusing.
///
/// `set_store_location_from_visit` enforces the same number server-side; change
/// both together.
const kMaxLocationAccuracyM = 50.0;

/// The oldest fallback fix that may still stand for "where the rep is now".
///
/// When no fresh fix arrives in [LocationService.kFixTimeout], the phone's last
/// known position is used instead. That position can be from the previous
/// shop: on 22 Sep 2026 a check-in at one store was recorded 1.9 km away, at
/// the mall the rep had left 12 minutes earlier, and 25 seconds later a
/// retry checked in on the store itself. A couple of minutes is "slightly
/// stale"; anything older is another place.
const kMaxFallbackFixAge = Duration(minutes: 2);

class LocationService {
  /// How long to wait for a fresh fix before falling back. Deep inside a large
  /// store a rep may never get one, and they still need to check out.
  static const kFixTimeout = Duration(seconds: 20);

  /// Ensures location services are on and permission is granted, then returns
  /// a high-accuracy fix. Throws [LocationDeniedException] with a
  /// user-presentable message when it can't.
  ///
  /// With [maxFallbackAge], the last-known fallback is refused (as a
  /// [StaleFixException]) when it is older than that, rather than returned as
  /// if it were where the rep is now.
  static Future<Position> getCurrentPosition({Duration? maxFallbackAge}) async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationDeniedException(
        'Location services are turned off. Turn them on to check in.',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      throw const LocationDeniedException(
        'Location permission is required to check in at a store.',
      );
    }
    if (permission == LocationPermission.deniedForever) {
      throw const LocationDeniedException(
        'Location permission is permanently denied. Enable it in Settings.',
      );
    }

    // geolocator's own `timeLimit` does not reliably fire when the platform
    // never emits a fix — observed hanging indefinitely on Android, which
    // latches the check-in/out button and strands the rep at the store. The
    // outer timeout is the one actually relied on.
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: kFixTimeout,
        ),
      ).timeout(kFixTimeout);
    } on TimeoutException {
      // A slightly stale fix is far better than blocking the visit; the
      // recorded distance still tells the manager where they were.
      final last = await Geolocator.getLastKnownPosition();
      if (last != null &&
          (maxFallbackAge == null || !isTooOld(last, maxFallbackAge))) {
        return last;
      }
      if (last != null) {
        throw const StaleFixException(
          "Couldn't get a fresh GPS fix. Move to where you have a clearer "
          'view of the sky and try again.',
        );
      }
      throw const LocationDeniedException(
        "Couldn't get a GPS fix. Move to where you have a clearer view of the "
        'sky and try again.',
      );
    }
  }

  /// Whether [position] was fixed more than [maxAge] before [now].
  static bool isTooOld(Position position, Duration maxAge, {DateTime? now}) =>
      (now ?? DateTime.now()).difference(position.timestamp) > maxAge;

  /// The position a check-in records, or null when only an old fix exists.
  ///
  /// Null, not a refusal: a rep must never be stranded at a store, so the
  /// check-in still goes ahead, just without a position. A visit with no
  /// coordinates reads as "no GPS"; one with a 12-minute-old fix reads as the
  /// rep being somewhere they were not.
  static Future<Position?> getCheckInPosition() async {
    try {
      return await getCurrentPosition(maxFallbackAge: kMaxFallbackFixAge);
    } on StaleFixException {
      return null;
    }
  }

  /// Straight-line metres between two points.
  static double distanceBetween(
    double lat1,
    double lng1,
    double lat2,
    double lng2,
  ) {
    return Geolocator.distanceBetween(lat1, lng1, lat2, lng2);
  }
}
