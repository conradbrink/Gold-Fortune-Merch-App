// A driver's round: which day a delivery is for, the town it is in, the
// order to drive them in, and the Google Maps links that drive it.
//
// Pure, so it is tested without a phone. The order comes from Google when the
// office has switched route planning on (web/app/api/route-plan, Compute
// Routes with optimizeWaypointOrder) and otherwise from [nearestFirst] here,
// which is the same rule as web/lib/route-plan.ts: from where the driver is
// standing, the closest stop, then the closest to that. Free, and it works
// with no signal.

import 'dart:math' as math;

import '../../core/location_service.dart';
import '../../data/models/delivery.dart';

/// One delivery on a driver's round, with what the round needs: where it is
/// and which town it is in.
class RunStop {
  const RunStop({
    required this.delivery,
    required this.placeName,
    required this.town,
    required this.territory,
    required this.lat,
    required this.lng,
    required this.deliveryAddress,
    required this.state,
  });

  final Delivery delivery;
  String get id => delivery.id;

  /// The place's own name; null when it has none (the card says "Unknown
  /// location", which must never be searched for on a map).
  final String? placeName;
  final String? town;
  final String? territory;
  final double? lat;
  final double? lng;

  /// Typed on the order when this drop is not at the usual address.
  final String? deliveryAddress;
  final String? state;

  bool get pinned => lat != null && lng != null && deliveryAddress == null;

  /// The town it is in, else its territory; how the round is grouped.
  String get area => town ?? territory ?? 'No town on record';

  /// What Google Maps is given for this stop, as the delivery screen finds a
  /// place (`DeliveryDetail.directions`): a typed delivery address first, then
  /// the pin, then the name and address. Null when there is nothing at all.
  String? get mapsPlace {
    if (deliveryAddress != null) return deliveryAddress;
    if (lat != null && lng != null) return '$lat,$lng';
    final parts = [
      placeName,
      delivery.storeAddress,
      town,
      state,
    ].whereType<String>();
    return parts.isEmpty ? null : parts.join(', ');
  }

  factory RunStop.fromMap(Map<String, dynamic> m) {
    final order = m['order'] as Map<String, dynamic>?;
    final store = order?['store'] as Map<String, dynamic>?;
    final territory = store?['territory'] as Map<String, dynamic>?;
    return RunStop(
      delivery: Delivery.fromMap(m),
      placeName: _text(store?['name']),
      town: _text(store?['city']),
      territory: _text(territory?['name']),
      lat: (store?['lat'] as num?)?.toDouble(),
      lng: (store?['lng'] as num?)?.toDouble(),
      deliveryAddress: _text(order?['delivery_address']),
      state: _text(store?['state']),
    );
  }
}

String? _text(Object? v) {
  final s = (v as String?)?.trim();
  return s == null || s.isEmpty ? null : s;
}

DateTime _date(DateTime d) => DateTime(d.year, d.month, d.day);

/// The day a delivery is for: the day the warehouse expects it, else the day
/// it left. One still on the road from before [today] is today's: it is late,
/// and today is when it gets driven.
DateTime dayOf(Delivery d, DateTime today) {
  final day = _date(d.expectedOn ?? d.dispatchedAt);
  final t = _date(today);
  return d.isOutstanding && day.isBefore(t) ? t : day;
}

/// The days worth offering: today always, then every later day with a
/// delivery still on the road, in order.
List<DateTime> runDays(List<RunStop> stops, DateTime today) {
  final t = _date(today);
  final days = <DateTime>{t};
  for (final s in stops) {
    if (s.delivery.isOutstanding) days.add(dayOf(s.delivery, today));
  }
  return days.where((d) => !d.isBefore(t)).toList()..sort();
}

/// Stops grouped by town, the towns in alphabetical order and the stops in
/// each by name, so the list reads the same every time it is opened.
List<({String area, List<RunStop> stops})> byArea(List<RunStop> stops) {
  final groups = <String, List<RunStop>>{};
  for (final s in stops) {
    groups.putIfAbsent(s.area, () => []).add(s);
  }
  final areas = groups.keys.toList()
    ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
  return [
    for (final a in areas)
      (
        area: a,
        stops: groups[a]!
          ..sort(
            (x, y) => x.delivery.storeName.toLowerCase().compareTo(
              y.delivery.storeName.toLowerCase(),
            ),
          ),
      ),
  ];
}

/// Straight-line metres, as the rest of the app measures them.
double _metres(double lat1, double lng1, double lat2, double lng2) =>
    LocationService.distanceBetween(lat1, lng1, lat2, lng2);

/// Stop ids in a short straight-line order from ([lat], [lng]): nearest
/// first, then untangled with 2-opt, the driver's position held fixed and the
/// end left free. The same two passes the web planner uses for a rep's day
/// (web/lib/geo.ts `orderStops`), where 2-opt took about a fifth off the
/// real drive. A stop Google Maps can only find by its address has no point
/// to measure from, so those go last, in the order they came.
List<String> nearestFirst(double lat, double lng, List<RunStop> stops) {
  final pinned = stops.where((s) => s.pinned).toList();
  final rest = stops.where((s) => !s.pinned);
  final order = <RunStop>[];
  var hereLat = lat;
  var hereLng = lng;
  while (pinned.isNotEmpty) {
    var best = 0;
    var bestM = double.infinity;
    for (var i = 0; i < pinned.length; i++) {
      final m = _metres(hereLat, hereLng, pinned[i].lat!, pinned[i].lng!);
      if (m < bestM) {
        bestM = m;
        best = i;
      }
    }
    final next = pinned.removeAt(best);
    order.add(next);
    hereLat = next.lat!;
    hereLng = next.lng!;
  }
  final untangled = _twoOpt(lat, lng, order);
  return [...untangled.map((s) => s.id), ...rest.map((s) => s.id)];
}

/// Reverses any stretch of the round that makes it shorter, until none does.
/// Point 0 is the driver, who stays where they are; the round ends wherever it
/// ends, so a reversal running to the last stop has no leg after it.
List<RunStop> _twoOpt(double lat, double lng, List<RunStop> stops) {
  final route = [...stops];
  double d(int a, int b) {
    final (aLat, aLng) = a < 0 ? (lat, lng) : (route[a].lat!, route[a].lng!);
    return _metres(aLat, aLng, route[b].lat!, route[b].lng!);
  }

  var improved = true;
  // Bounded: a round of a few dozen stops settles in a handful of passes.
  for (var pass = 0; improved && pass < 50; pass++) {
    improved = false;
    for (var i = 0; i < route.length - 1; i++) {
      for (var k = i + 1; k < route.length; k++) {
        // Reverse route[i..k]: the legs (i-1 -> i) and (k -> k+1) become
        // (i-1 -> k) and (i -> k+1).
        final before = d(i - 1, i) + (k + 1 < route.length ? d(k, k + 1) : 0);
        final after = d(i - 1, k) + (k + 1 < route.length ? d(i, k + 1) : 0);
        if (after + 0.5 < before) {
          final flipped = route.sublist(i, k + 1).reversed.toList();
          route.replaceRange(i, k + 1, flipped);
          improved = true;
        }
      }
    }
  }
  return route;
}

/// How many stops one Google Maps link carries: nine waypoints and the
/// destination. Maps refuses more waypoints than that, so a longer round is
/// driven in legs, each starting where the last one ended.
const kStopsPerLeg = 10;

/// One Google Maps link for part of the round.
class MapsLeg {
  const MapsLeg({required this.first, required this.last, required this.uri});

  /// The stops it covers, counted from 1 along the round.
  final int first;
  final int last;
  final Uri uri;
}

/// Google Maps directions through [stops] in order, split into legs of
/// [kStopsPerLeg]. The first leg starts from wherever the phone is (no
/// origin, which Maps reads as "your location"); every later one starts at
/// the stop the leg before it ended on. Stops Maps cannot find are skipped.
List<MapsLeg> mapsLegs(List<RunStop> stops) {
  final findable = [
    for (var i = 0; i < stops.length; i++)
      if (stops[i].mapsPlace != null) (n: i + 1, place: stops[i].mapsPlace!),
  ];
  final legs = <MapsLeg>[];
  for (var start = 0; start < findable.length; start += kStopsPerLeg) {
    final end = math.min(start + kStopsPerLeg, findable.length);
    final leg = findable.sublist(start, end);
    final params = <String, String>{
      'api': '1',
      'travelmode': 'driving',
      if (start > 0) 'origin': findable[start - 1].place,
      'destination': leg.last.place,
      if (leg.length > 1)
        'waypoints': leg
            .sublist(0, leg.length - 1)
            .map((s) => s.place)
            .join('|'),
    };
    legs.add(
      MapsLeg(
        first: leg.first.n,
        last: leg.last.n,
        uri: Uri.https('www.google.com', '/maps/dir/', params),
      ),
    );
  }
  return legs;
}

/// A round put in order, and where the order came from.
class RoutePlan {
  const RoutePlan({
    required this.order,
    required this.byGoogle,
    this.distanceMeters,
    this.durationSeconds,
    this.note,
  });

  /// Dispatch ids in driving order.
  final List<String> order;

  /// Google's roads, as against nearest first by straight line.
  final bool byGoogle;
  final int? distanceMeters;
  final int? durationSeconds;

  /// Why it is nearest first, when it is, in words for the driver.
  final String? note;

  /// "81 km, about 1 h 10 min", when Google said.
  String? get summary {
    final m = distanceMeters;
    final s = durationSeconds;
    if (m == null) return null;
    final km = (m / 1000).round();
    if (s == null) return '$km km';
    final minutes = (s / 60).round();
    final h = minutes ~/ 60;
    final min = minutes % 60;
    final time = h == 0 ? '$min min' : (min == 0 ? '$h h' : '$h h $min min');
    return '$km km, about $time';
  }
}
