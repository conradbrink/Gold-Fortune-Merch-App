// A driver's round (lib/features/driver): which day a delivery is for, the
// towns it is grouped by, nearest-first ordering, the Google Maps legs, and
// the home screen a driver login opens on.
//
// No Supabase client and no GPS: the repository is a fake, and planning (which
// needs a position) is tested through the pure functions it calls.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/providers.dart';
import 'package:gf_merch_rep/core/terms.dart';
import 'package:gf_merch_rep/data/repositories/driver_repository.dart';
import 'package:gf_merch_rep/features/driver/driver_home_screen.dart';
import 'package:gf_merch_rep/features/driver/route_plan.dart';

String _iso(DateTime d) =>
    '${d.year}-${'${d.month}'.padLeft(2, '0')}-${'${d.day}'.padLeft(2, '0')}';

/// A dispatch as the driver's select returns it.
Map<String, dynamic> _row(
  String id, {
  String name = 'Spar',
  String? city = 'Potchefstroom',
  String? territory,
  double? lat,
  double? lng,
  String? address = '1 Church Street',
  String? deliveryAddress,
  String status = 'in_transit',
  DateTime? expected,
  DateTime? dispatched,
  DateTime? deliveredAt,
}) => {
  'id': id,
  'dispatch_number': 'DSP-$id',
  'status': status,
  'dispatched_at': (dispatched ?? DateTime(2026, 10, 29, 7))
      .toUtc()
      .toIso8601String(),
  'expected_delivery_on': expected == null ? null : _iso(expected),
  'delivered_at': deliveredAt?.toUtc().toIso8601String(),
  'carrier_name': null,
  'tracking_reference': null,
  'order': {
    'order_number': 'SO-$id',
    'delivery_address': deliveryAddress,
    'store': {
      'name': name,
      'address': address,
      'city': city,
      'state': 'North West',
      'lat': lat,
      'lng': lng,
      'territory': territory == null ? null : {'name': territory},
    },
  },
  'lines': [
    {'qty': 10},
  ],
};

RunStop _stop(
  String id, {
  double? lat,
  double? lng,
  String? city = 'Potchefstroom',
  String name = 'Spar',
  String? deliveryAddress,
  String? address = '1 Church Street',
}) => RunStop.fromMap(
  _row(
    id,
    lat: lat,
    lng: lng,
    city: city,
    name: name,
    deliveryAddress: deliveryAddress,
    address: address,
  ),
);

class _FakeDriverRepository implements DriverRepository {
  _FakeDriverRepository(this.stops);
  final List<RunStop> stops;

  @override
  Future<List<RunStop>> myRun({DateTime? now}) async => stops;

  @override
  Future<RoutePlan?> googleOrder({
    required double lat,
    required double lng,
    required List<String> dispatchIds,
  }) async => null;
}

void main() {
  final today = DateTime(2026, 10, 29, 9);

  group('the day a delivery is for', () {
    test('the expected day, else the day it left', () {
      final a = RunStop.fromMap(
        _row('a', expected: DateTime(2026, 10, 31)),
      ).delivery;
      final b = RunStop.fromMap(
        _row('b', dispatched: DateTime(2026, 10, 30, 6)),
      ).delivery;
      expect(dayOf(a, today), DateTime(2026, 10, 31));
      expect(dayOf(b, today), DateTime(2026, 10, 30));
    });

    test('one still on the road from before today is today’s', () {
      final late = RunStop.fromMap(
        _row('a', expected: DateTime(2026, 10, 27)),
      ).delivery;
      expect(dayOf(late, today), DateTime(2026, 10, 29));
    });

    test('today always, then later days with something on the road', () {
      final stops = [
        RunStop.fromMap(_row('a', expected: DateTime(2026, 11, 2))),
        RunStop.fromMap(_row('b', expected: DateTime(2026, 10, 30))),
        RunStop.fromMap(
          _row('c', expected: DateTime(2026, 11, 5), status: 'delivered'),
        ),
      ];
      expect(runDays(stops, today), [
        DateTime(2026, 10, 29),
        DateTime(2026, 10, 30),
        DateTime(2026, 11, 2),
      ]);
    });
  });

  test('grouped by town, else by territory, the towns in order', () {
    final groups = byArea([
      RunStop.fromMap(_row('a', city: 'Potchefstroom', name: 'Spar')),
      RunStop.fromMap(_row('b', city: 'Klerksdorp', name: 'OK Foods')),
      RunStop.fromMap(_row('c', city: null, territory: 'Dr Kenneth Kaunda')),
      RunStop.fromMap(_row('d', city: 'Potchefstroom', name: 'Boxer')),
      RunStop.fromMap(_row('e', city: null)),
    ]);
    expect(groups.map((g) => g.area), [
      'Dr Kenneth Kaunda',
      'Klerksdorp',
      'No town on record',
      'Potchefstroom',
    ]);
    expect(groups.last.stops.map((s) => s.id), ['d', 'a']);
  });

  group('nearest first', () {
    // From Klerksdorp: Stilfontein 11 km, Orkney 15 km south, Potchefstroom 45 km east.
    final stil = _stop('stil', lat: -26.84, lng: 26.77);
    final orkney = _stop('orkney', lat: -26.98, lng: 26.67);
    final potch = _stop('potch', lat: -26.71, lng: 27.1);

    test('the closest stop first, then untangled', () {
      // Nearest first alone is Stilfontein, Orkney, Potchefstroom (about
      // 78 km); starting at Orkney instead is about 67 km.
      expect(nearestFirst(-26.85, 26.66, [potch, orkney, stil]), [
        'orkney',
        'stil',
        'potch',
      ]);
    });

    test('a stop found only by its address goes last, as it came', () {
      final noPin = _stop('nopin');
      final typed = _stop(
        'typed',
        lat: -26.85,
        lng: 26.66,
        deliveryAddress: 'Back gate',
      );
      expect(nearestFirst(-26.85, 26.66, [noPin, potch, typed, stil]), [
        'stil',
        'potch',
        'nopin',
        'typed',
      ]);
    });

  });

  group('Google Maps legs', () {
    test('one leg: no origin, the stops between as waypoints', () {
      final legs = mapsLegs([
        _stop('a', lat: -26.8, lng: 26.7),
        _stop('b', deliveryAddress: 'Back gate, 3 Wolmarans St'),
        _stop('c', lat: null, name: 'OK Foods', address: '5 Main Rd'),
      ]);
      expect(legs, hasLength(1));
      final q = legs.single.uri.queryParameters;
      expect(legs.single.uri.host, 'www.google.com');
      expect(q.containsKey('origin'), isFalse);
      expect(q['waypoints'], '-26.8,26.7|Back gate, 3 Wolmarans St');
      expect(
        q['destination'],
        'OK Foods, 5 Main Rd, Potchefstroom, North West',
      );
      expect(q['travelmode'], 'driving');
      expect((legs.single.first, legs.single.last), (1, 3));
    });

    test('23 stops are three legs, each starting where the last ended', () {
      final stops = [
        for (var i = 0; i < 23; i++)
          _stop('s$i', lat: -26.0 - i / 100, lng: 27.0),
      ];
      final legs = mapsLegs(stops);
      expect(legs.map((l) => (l.first, l.last)), [(1, 10), (11, 20), (21, 23)]);
      for (final l in legs) {
        final waypoints =
            l.uri.queryParameters['waypoints']?.split('|') ?? const [];
        expect(waypoints.length, lessThanOrEqualTo(9));
      }
      expect(legs[1].uri.queryParameters['origin'], stops[9].mapsPlace);
      expect(legs[2].uri.queryParameters['origin'], stops[19].mapsPlace);
      expect(legs[2].uri.queryParameters['destination'], stops[22].mapsPlace);
    });

    test('a stop with nothing to find it by is skipped', () {
      final legs = mapsLegs([
        _stop('a', lat: -26.8, lng: 26.7),
        RunStop.fromMap(
          _row('b', name: '', city: null, address: null)
            ..['order']['store']['state'] = null,
        ),
      ]);
      expect(legs.single.uri.queryParameters['destination'], '-26.8,26.7');
      expect((legs.single.first, legs.single.last), (1, 1));
    });
  });

  test('the plan says how far and how long when Google did', () {
    expect(
      const RoutePlan(
        order: [],
        byGoogle: true,
        distanceMeters: 81400,
        durationSeconds: 4200,
      ).summary,
      '81 km, about 1 h 10 min',
    );
    expect(
      const RoutePlan(
        order: [],
        byGoogle: true,
        distanceMeters: 5000,
        durationSeconds: 600,
      ).summary,
      '5 km, about 10 min',
    );
    expect(const RoutePlan(order: [], byGoogle: false).summary, isNull);
  });

  group('the driver home', () {
    Future<void> pump(WidgetTester tester, List<RunStop> stops) async {
      await tester.pumpWidget(
        ProviderScope(
          key: UniqueKey(),
          overrides: [
            currentUserProvider.overrideWithValue(null as User?),
            driverRepositoryProvider.overrideWithValue(
              _FakeDriverRepository(stops),
            ),
            pendingDeliveryConfirmsProvider.overrideWith(
              (ref) async => <String>{},
            ),
            companyConfigValueProvider.overrideWithValue(
              CompanyConfig.fallback,
            ),
            termsProvider.overrideWithValue(Terms.defaults),
          ],
          child: const MaterialApp(home: DriverHomeScreen()),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('today’s deliveries by town, with Plan my route', (
      tester,
    ) async {
      final now = DateTime.now();
      await pump(tester, [
        RunStop.fromMap(
          _row('a', city: 'Potchefstroom', name: 'Spar', expected: now),
        ),
        RunStop.fromMap(
          _row('b', city: 'Klerksdorp', name: 'OK Foods', expected: now),
        ),
        RunStop.fromMap(
          _row('c', city: 'Klerksdorp', name: 'Boxer', expected: now),
        ),
        RunStop.fromMap(
          _row(
            'd',
            city: 'Orkney',
            name: 'Later',
            expected: now.add(const Duration(days: 3)),
          ),
        ),
      ]);
      expect(find.text('Today (3)'), findsOneWidget);
      expect(find.textContaining('(1)'), findsOneWidget);
      expect(find.text('3 deliveries to drop in 2 towns'), findsOneWidget);
      expect(find.text('Klerksdorp · 2'), findsOneWidget);
      expect(find.text('Potchefstroom · 1'), findsOneWidget);
      expect(find.text('Plan my route'), findsOneWidget);
      expect(find.text('Later'), findsNothing);
    });

    testWidgets('another day shows only that day’s', (tester) async {
      final now = DateTime.now();
      await pump(tester, [
        RunStop.fromMap(
          _row('a', city: 'Potchefstroom', name: 'Spar', expected: now),
        ),
        RunStop.fromMap(
          _row(
            'd',
            city: 'Orkney',
            name: 'Later',
            expected: now.add(const Duration(days: 3)),
          ),
        ),
      ]);
      await tester.tap(find.textContaining('(1)').last);
      await tester.pumpAndSettle();
      expect(find.text('Later'), findsOneWidget);
      expect(find.text('Spar'), findsNothing);
      expect(find.text('Orkney · 1'), findsOneWidget);
    });

    testWidgets('nothing given yet says so', (tester) async {
      await pump(tester, const []);
      expect(find.text('Today (0)'), findsOneWidget);
      expect(find.text('Nothing to deliver'), findsOneWidget);
      expect(find.text('Plan my route'), findsNothing);
    });
  });
}
