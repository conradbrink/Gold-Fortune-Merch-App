// A rep's day in driving order, the pure part: which stops a plan may move,
// how a plan is laid over the day, and how it is made from a position. No
// location, no storage, so RouteRepository can lay a plan over the day
// without importing the planner (visit_plan.dart), which uses the repository.

import '../../data/models/route_visit.dart';
import '../driver/route_plan.dart';

/// A stop on a rep's day, as the planner and Google Maps need it.
class VisitStop implements PlanStop {
  const VisitStop(this.visit);

  final RouteVisit visit;

  @override
  String get id => visit.cacheKey;

  @override
  double? get lat => visit.storeLat;

  @override
  double? get lng => visit.storeLng;

  @override
  bool get pinned => lat != null && lng != null;

  /// The pin, else the place's name and address, as the visit screen finds it.
  @override
  String? get mapsPlace {
    if (pinned) return '$lat,$lng';
    final parts = [
      if (visit.storeName != RouteVisit.unknownStoreName) visit.storeName,
      visit.storeAddress,
      visit.storeCity,
      visit.storeState,
    ].whereType<String>().map((s) => s.trim()).where((s) => s.isNotEmpty);
    return parts.isEmpty ? null : parts.join(', ');
  }
}

/// Still to go to: not checked in, not checked out, not missed. Only these
/// are ever moved by a plan; a stop the rep has been to keeps its place.
bool stillToVisit(RouteVisit v) => v.status == 'not_started';

/// [day] with its stops still to visit put in [order], each into the place on
/// the list that a stop still to visit had. Stops the rep has been to stay
/// exactly where they were. One not in the plan (added since, or a plan from
/// before it was scheduled) follows the planned ones, in the order it had.
List<RouteVisit> inPlannedOrder(List<RouteVisit> day, List<String> order) {
  final rank = {for (var i = 0; i < order.length; i++) order[i]: i};
  final toVisit = day.where(stillToVisit).toList();
  final planned = toVisit.where((v) => rank.containsKey(v.cacheKey)).toList()
    ..sort((a, b) => rank[a.cacheKey]!.compareTo(rank[b.cacheKey]!));
  final next = [
    ...planned,
    ...toVisit.where((v) => !rank.containsKey(v.cacheKey)),
  ].iterator;
  return [
    for (final v in day)
      if (stillToVisit(v)) (next..moveNext()).current else v,
  ];
}

/// The day's stops still to visit, in the order they are on the list.
List<VisitStop> stopsToVisit(List<RouteVisit> day) => [
  for (final v in day)
    if (stillToVisit(v)) VisitStop(v),
];

/// A plan for [day]'s stops still to visit from ([lat], [lng]); null when
/// fewer than two are left, and there is nothing to order.
///
/// [google] is asked first, with route ids. A stop the rep added today has no
/// route on the server to send, so a day with one of those still to visit is
/// planned by straight line instead, all of it.
Future<RoutePlan?> planDay({
  required List<RouteVisit> day,
  required double lat,
  required double lng,
  required Future<RoutePlan?> Function(List<String> routeIds) google,
}) async {
  final stops = stopsToVisit(day);
  if (stops.length < 2) return null;
  final routeIds = [for (final s in stops) s.visit.routeId];
  final byGoogle = routeIds.every((id) => id != null)
      ? await google(routeIds.cast<String>())
      : null;
  return byGoogle ??
      RoutePlan(
        order: nearestFirst(lat, lng, stops),
        byGoogle: false,
        note: straightLineNote(unpinned: stops.any((s) => !s.pinned)),
      );
}

/// Whether [plan] still covers exactly the stops left to visit on [day], so
/// what Google said about its distance and time is still about this drive.
bool planStillWhole(RoutePlan plan, List<RouteVisit> day) {
  final left = {for (final s in stopsToVisit(day)) s.id};
  return left.length == plan.order.length && left.containsAll(plan.order);
}
