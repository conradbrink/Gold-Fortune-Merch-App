// A rep's day in driving order (lib/features/route_today/visit_plan.dart):
// only the stops still to visit move, Google first and nearest first without
// it, the plan kept on the phone for the day and laid over the list when it
// is read, and Google Maps given each stop.
//
// No GPS: planning is tested through planDay, which takes the position.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/models/route_visit.dart';
import 'package:gf_merch_rep/data/repositories/route_plan_api.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:gf_merch_rep/features/driver/route_plan.dart';
import 'package:gf_merch_rep/features/route_today/visit_plan.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

// Klerksdorp, with Stilfontein 10 km east, Orkney 15 km south and
// Potchefstroom 45 km east.
const hereLat = -26.85;
const hereLng = 26.66;

RouteVisit visit(
  String id, {
  String status = 'not_started',
  double? lat,
  double? lng,
  int? seq,
  bool unscheduled = false,
  String name = 'Spar',
  String? address = '1 Church Street',
  String? city = 'Klerksdorp',
}) => RouteVisit(
  routeId: unscheduled ? null : id,
  storeId: 'store-$id',
  storeName: name,
  storeAddress: address,
  storeCity: city,
  storeLat: lat,
  storeLng: lng,
  geofenceRadiusM: 100,
  sequenceOrder: seq,
  visitClientGeneratedId: unscheduled ? id : null,
  status: status,
);

final potch = visit('potch', lat: -26.71, lng: 27.1, seq: 1);
final orkney = visit('orkney', lat: -26.98, lng: 26.67, seq: 2);
final stil = visit('stil', lat: -26.84, lng: 26.77, seq: 3);

List<String> ids(List<RouteVisit> day) => [for (final v in day) v.cacheKey];

void main() {
  group('the plan laid over the day', () {
    test('stops still to visit take the plan’s order', () {
      expect(
        ids(inPlannedOrder([potch, orkney, stil], ['stil', 'orkney', 'potch'])),
        ['stil', 'orkney', 'potch'],
      );
    });

    test('a stop the rep has been to keeps its place', () {
      final done = visit('done', status: 'checked_out', seq: 2);
      final inShop = visit('in', status: 'checked_in', seq: 4);
      final missed = visit('missed', status: 'missed', seq: 5);
      final day = [potch, done, orkney, inShop, missed, stil];
      expect(ids(inPlannedOrder(day, ['stil', 'orkney', 'potch'])), [
        'stil',
        'done',
        'orkney',
        'in',
        'missed',
        'potch',
      ]);
    });

    test('a stop that is not in the plan follows the planned ones', () {
      final added = visit('added', unscheduled: true);
      expect(ids(inPlannedOrder([added, potch, stil], ['stil', 'potch'])), [
        'stil',
        'potch',
        'added',
      ]);
    });

    test('a plan naming stops no longer on the day changes nothing else', () {
      expect(ids(inPlannedOrder([potch, stil], ['gone', 'stil', 'potch'])), [
        'stil',
        'potch',
      ]);
    });
  });

  group('planning the day', () {
    test('fewer than two stops still to visit is nothing to plan', () async {
      final done = visit('done', status: 'checked_out');
      var asked = false;
      final plan = await planDay(
        day: [done, potch],
        lat: hereLat,
        lng: hereLng,
        google: (_) async {
          asked = true;
          return null;
        },
      );
      expect(plan, isNull);
      expect(asked, isFalse);
    });

    test(
      'Google is asked with the route ids of the stops still to visit',
      () async {
        final done = visit('done', status: 'checked_in');
        List<String>? sent;
        final plan = await planDay(
          day: [done, potch, orkney, stil],
          lat: hereLat,
          lng: hereLng,
          google: (routeIds) async {
            sent = routeIds;
            return const RoutePlan(
              order: ['orkney', 'stil', 'potch'],
              byGoogle: true,
            );
          },
        );
        expect(sent, ['potch', 'orkney', 'stil']);
        expect(plan!.byGoogle, isTrue);
        expect(plan.order, ['orkney', 'stil', 'potch']);
      },
    );

    test(
      'with no answer from Google, nearest first by straight line',
      () async {
        final plan = await planDay(
          day: [potch, orkney, stil],
          lat: hereLat,
          lng: hereLng,
          google: (_) async => null,
        );
        expect(plan!.byGoogle, isFalse);
        // Nearest first is Stilfontein, Orkney, Potchefstroom (about 78 km);
        // untangled, starting at Orkney, about 67 km. As for a driver.
        expect(plan.order, ['orkney', 'stil', 'potch']);
        expect(plan.note, contains('straight line'));
      },
    );

    test(
      'a stop added today has no route to send, so all is straight line',
      () async {
        final added = visit('added', unscheduled: true, lat: -26.86, lng: 26.7);
        var asked = false;
        final plan = await planDay(
          day: [potch, added, stil],
          lat: hereLat,
          lng: hereLng,
          google: (_) async {
            asked = true;
            return null;
          },
        );
        expect(asked, isFalse);
        expect(plan!.order, ['added', 'stil', 'potch']);
      },
    );

    test('a stop with no pin goes last, and the note says so', () async {
      final noPin = visit('nopin', seq: 0);
      final plan = await planDay(
        day: [noPin, potch, stil],
        lat: hereLat,
        lng: hereLng,
        google: (_) async => null,
      );
      expect(plan!.order, ['stil', 'potch', 'nopin']);
      expect(plan.note, contains('not on the map yet'));
    });
  });

  test('Google’s distance is only for the drive it was planned for', () {
    const plan = RoutePlan(order: ['potch', 'orkney'], byGoogle: true);
    expect(planStillWhole(plan, [potch, orkney]), isTrue);
    final done = visit('potch', status: 'checked_out', lat: -26.71, lng: 27.1);
    expect(planStillWhole(plan, [done, orkney]), isFalse);
    expect(planStillWhole(plan, [potch, orkney, stil]), isFalse);
  });

  group('Google Maps', () {
    test('a stop is found by its pin, else its name and address', () {
      expect(VisitStop(potch).mapsPlace, '-26.71,27.1');
      expect(
        VisitStop(visit('a', city: 'Orkney')).mapsPlace,
        'Spar, 1 Church Street, Orkney',
      );
      expect(
        VisitStop(
          visit(
            'b',
            name: RouteVisit.unknownStoreName,
            address: null,
            city: null,
          ),
        ).mapsPlace,
        isNull,
      );
    });

    test('a long day is driven in parts of ten', () {
      final day = [
        for (var i = 0; i < 12; i++)
          visit('s$i', lat: -26.8 + i / 100, lng: 26.7),
      ];
      final legs = mapsLegs(stopsToVisit(day));
      expect(legs.map((l) => (l.first, l.last)), [(1, 10), (11, 12)]);
    });
  });

  group('the answer from the server', () {
    test('visits are sent as route ids, deliveries as dispatch ids', () {
      expect(PlanKind.visits.field, 'routeIds');
      expect(PlanKind.deliveries.field, 'dispatchIds');
    });

    test('an order that loses or repeats a stop is not used', () {
      final sent = ['a', 'b', 'c'];
      expect(
        planFromAnswer({
          'order': ['a', 'b'],
        }, sent),
        isNull,
      );
      expect(
        planFromAnswer({
          'order': ['a', 'a', 'b'],
        }, sent),
        isNull,
      );
      expect(
        planFromAnswer({
          'order': ['a', 'b', 'x'],
        }, sent),
        isNull,
      );
      expect(planFromAnswer('nonsense', sent), isNull);
      final plan = planFromAnswer({
        'order': ['c', 'a', 'b'],
        'distanceMeters': 81000,
        'durationSeconds': 4200,
      }, sent);
      expect(plan!.order, ['c', 'a', 'b']);
      expect(plan.summary, '81 km, about 1 h 10 min');
    });

    test('a plan reads back as it was kept', () {
      const plan = RoutePlan(
        order: ['a', 'b'],
        byGoogle: true,
        distanceMeters: 1200,
        durationSeconds: 300,
      );
      final back = RoutePlan.fromMap(
        jsonDecode(jsonEncode(plan.toMap())) as Map<String, dynamic>,
      )!;
      expect(back.order, plan.order);
      expect(back.byGoogle, isTrue);
      expect(back.summary, plan.summary);
      expect(RoutePlan.fromMap({'order': 'a'}), isNull);
    });
  });

  group('kept on the phone for the day', () {
    late AppDatabase db;
    late SupabaseClient client;
    final day = DateTime(2026, 10, 29);

    setUp(() {
      db = AppDatabase.forTesting(NativeDatabase.memory());
      client = SupabaseClient(
        'http://localhost:54321',
        'anon-key',
        httpClient: MockClient(
          (request) async => http.Response(
            jsonEncode([potch.toMap(), orkney.toMap(), stil.toMap()]),
            200,
            headers: {'content-type': 'application/json'},
            request: request,
          ),
        ),
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
    });

    tearDown(() async {
      await client.dispose();
      await db.close();
    });

    test('the day comes back in the plan’s order, from the server', () async {
      final repo = RouteRepository(client, db);
      await repo.saveVisitPlan(
        'rep-1',
        day,
        const RoutePlan(order: ['stil', 'orkney', 'potch'], byGoogle: false),
      );
      expect(ids(await repo.fetchRoutesForDate('rep-1', day)), [
        'stil',
        'orkney',
        'potch',
      ]);
      expect((await repo.savedVisitPlan('rep-1', day))!.order.first, 'stil');
    });

    test('yesterday’s plan is not today’s', () async {
      final repo = RouteRepository(client, db);
      await repo.saveVisitPlan(
        'rep-1',
        day.subtract(const Duration(days: 1)),
        const RoutePlan(order: ['stil', 'orkney', 'potch'], byGoogle: false),
      );
      expect(await repo.savedVisitPlan('rep-1', day), isNull);
      expect(ids(await repo.fetchRoutesForDate('rep-1', day)), [
        'potch',
        'orkney',
        'stil',
      ]);
    });

    test('a plan that does not read back is no plan', () async {
      await db.setValue(
        'visit_plan',
        jsonEncode({
          'rep_id': 'rep-1',
          'date': RouteRepository.formatDate(day),
          'plan': {'order': <String>[], 'distance_m': 'far'},
        }),
      );
      final repo = RouteRepository(client, db);
      expect(await repo.savedVisitPlan('rep-1', day), isNull);
      // And the day still shows, in the order it had.
      expect(ids(await repo.fetchRoutesForDate('rep-1', day)), [
        'potch',
        'orkney',
        'stil',
      ]);
      await db.setValue('visit_plan', '{not json');
      expect(
        await RouteRepository(client, db).savedVisitPlan('rep-1', day),
        isNull,
      );
    });

    test('a colleague’s plan on a shared phone is not mine', () async {
      final repo = RouteRepository(client, db);
      await repo.saveVisitPlan(
        'rep-2',
        day,
        const RoutePlan(order: ['stil', 'orkney', 'potch'], byGoogle: true),
      );
      expect(await repo.savedVisitPlan('rep-1', day), isNull);
      expect(ids(await repo.fetchRoutesForDate('rep-1', day)), [
        'potch',
        'orkney',
        'stil',
      ]);
    });
  });
}
