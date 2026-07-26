import 'dart:async';

import 'package:geolocator/geolocator.dart';

class LocationDeniedException implements Exception {
  final String message;
  const LocationDeniedException(this.message);
  @override
  String toString() => message;
}

class LocationService {
  /// How long to wait for a fresh fix before falling back. Deep inside a large
  /// store a rep may never get one, and they still need to check out.
  static const kFixTimeout = Duration(seconds: 20);

  /// Ensures location services are on and permission is granted, then returns
  /// a high-accuracy fix. Throws [LocationDeniedException] with a
  /// user-presentable message when it can't.
  static Future<Position> getCurrentPosition() async {
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
      if (last != null) return last;
      throw const LocationDeniedException(
        "Couldn't get a GPS fix. Move to where you have a clearer view of the "
        'sky and try again.',
      );
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
