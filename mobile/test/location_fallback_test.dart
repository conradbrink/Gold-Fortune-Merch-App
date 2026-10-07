// A check-in on 22 Sep 2026 was recorded 1.9 km from its store, at the mall the
// rep had left 12 minutes earlier: no fresh fix came, and the phone's last
// known position stood in for "here". The fallback now has an age limit.

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

import 'package:gf_merch_rep/core/location_service.dart';

Position _fixAt(DateTime at) => Position(
  latitude: -24.6108,
  longitude: 25.9182,
  timestamp: at,
  accuracy: 17,
  altitude: 0,
  altitudeAccuracy: 0,
  heading: 0,
  headingAccuracy: 0,
  speed: 0,
  speedAccuracy: 0,
);

void main() {
  final now = DateTime.utc(2026, 9, 22, 8, 20, 23);

  test('a fix from the last shop, 12 minutes ago, is too old', () {
    final fix = _fixAt(now.subtract(const Duration(minutes: 12)));
    expect(LocationService.isTooOld(fix, kMaxFallbackFixAge, now: now), isTrue);
  });

  test('a fix from a moment ago still stands', () {
    final fix = _fixAt(now.subtract(const Duration(seconds: 40)));
    expect(
      LocationService.isTooOld(fix, kMaxFallbackFixAge, now: now),
      isFalse,
    );
  });

  test('the limit itself is still accepted', () {
    final fix = _fixAt(now.subtract(kMaxFallbackFixAge));
    expect(
      LocationService.isTooOld(fix, kMaxFallbackFixAge, now: now),
      isFalse,
    );
  });

  test('a stale fix is reported the way a denied one is', () {
    // Every screen already shows LocationDeniedException messages; the new
    // refusal must reach the rep through the same path.
    const e = StaleFixException('x');
    expect(e, isA<LocationDeniedException>());
  });
}
