// The rep's day must come back in the same order every time it is read,
// whether that read hit the server or the offline cache. It did not: the sort
// keyed on `scheduled_start_at`, which the call cycle never sets, so the list
// reshuffled between refreshes and a rep could not tell which stop was next.

import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/data/models/route_visit.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';

RouteVisit stop(String name, {int? sequence, String? routeId}) {
  return RouteVisit(
    routeId: routeId ?? (sequence == null ? null : 'route-$sequence'),
    storeId: 'store-$name',
    storeName: name,
    geofenceRadiusM: 100,
    sequenceOrder: sequence,
    status: 'not_started',
    visitClientGeneratedId: routeId == null && sequence == null ? name : null,
  );
}

void main() {
  group('compareStops', () {
    test('orders by the planner\'s sequence, not by name', () {
      final day = [
        stop('Choppies Kasane', sequence: 3),
        stop('Ackermans Maun', sequence: 1),
        stop('Sefalana Nata', sequence: 2),
      ]..sort(compareStops);

      expect(day.map((s) => s.storeName), [
        'Ackermans Maun',
        'Sefalana Nata',
        'Choppies Kasane',
      ]);
    });

    test('puts unscheduled visits after the planned ones', () {
      final day = [
        stop('Walk-in shop'),
        stop('Planned second', sequence: 2),
        stop('Planned first', sequence: 1),
      ]..sort(compareStops);

      expect(day.map((s) => s.storeName), [
        'Planned first',
        'Planned second',
        'Walk-in shop',
      ]);
    });

    test('breaks ties on store name so the order never wobbles', () {
      final ascending = [
        stop('Zebra Mall', sequence: 1, routeId: 'a'),
        stop('Aardvark Plaza', sequence: 1, routeId: 'b'),
      ]..sort(compareStops);
      final descending = [
        stop('Aardvark Plaza', sequence: 1, routeId: 'b'),
        stop('Zebra Mall', sequence: 1, routeId: 'a'),
      ]..sort(compareStops);

      expect(ascending.map((s) => s.storeName),
          descending.map((s) => s.storeName));
      expect(ascending.first.storeName, 'Aardvark Plaza');
    });

    test('routes with no sequence at all keep a stable name order', () {
      final day = [
        stop('Second shop'),
        stop('First shop'),
      ]..sort(compareStops);

      expect(day.map((s) => s.storeName), ['First shop', 'Second shop']);
    });
  });

  // The cache stores rows verbatim and rebuilds them offline, so anything the
  // sort depends on has to survive the round trip — otherwise the day is
  // ordered correctly online and arbitrarily on a phone with no signal.
  test('sequence_order survives the cache round trip', () {
    final original = stop('Choppies Game City', sequence: 4);
    final restored = RouteVisit.fromMap(original.toMap());

    expect(restored.sequenceOrder, 4);
    expect(restored.storeName, 'Choppies Game City');
  });

  test('a captured store location survives copyWith', () {
    final located = stop('Choppies Moshupa', sequence: 1)
        .copyWith(storeLat: -24.7701, storeLng: 25.4101);

    expect(located.storeLat, -24.7701);
    expect(located.storeLng, 25.4101);
    // The other fields must ride along, or the cached row loses its identity.
    expect(located.sequenceOrder, 1);
    expect(RouteVisit.fromMap(located.toMap()).storeLat, -24.7701);
  });
}
