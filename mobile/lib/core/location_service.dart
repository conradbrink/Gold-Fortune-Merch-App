import 'package:geolocator/geolocator.dart';

class LocationDeniedException implements Exception {
  final String message;
  const LocationDeniedException(this.message);
  @override
  String toString() => message;
}

class LocationService {
  /// Ensures location services are on and permission is granted, then returns
  /// a fresh high-accuracy fix. Throws [LocationDeniedException] with a
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

    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 30),
      ),
    );
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
