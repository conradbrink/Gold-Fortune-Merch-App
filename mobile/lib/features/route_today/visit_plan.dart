// A rep's day in driving order: the stops still to visit, put in the best
// order from where the rep is, once when the workday starts and again on
// "Plan my route".
//
// The same planner as a driver's round (lib/features/driver/route_plan.dart):
// Google's roads through the web's /api/route-plan when the office has
// switched it on, otherwise nearest first and untangled by straight line,
// which is free and works with no signal. The plan is kept on this phone for
// the day (RouteRepository.saveVisitPlan) and laid over the list every time it
// is read, so it lasts through a restart and a refresh.

import '../../core/location_service.dart';
import '../../data/models/route_visit.dart';
import '../../data/repositories/route_repository.dart';
import 'visit_order.dart';

export 'visit_order.dart';

/// The plan being made now, if one is. The automatic plan at the start of the
/// day can still be running when the rep taps "Plan my route"; the tap waits
/// for it instead of paying Google twice.
Future<String?>? _planning;

/// Plans today's list from where the rep is standing and keeps the plan on
/// the phone. Returns what to tell the rep when it could not be planned; null
/// when it was, or there was nothing to plan. The caller refreshes the list.
Future<String?> planToday(
  RouteRepository repo, {
  required String repId,
  required List<RouteVisit> day,
  required DateTime date,
}) {
  return _planning ??= _planToday(
    repo,
    repId: repId,
    day: day,
    date: date,
  ).whenComplete(() => _planning = null);
}

Future<String?> _planToday(
  RouteRepository repo, {
  required String repId,
  required List<RouteVisit> day,
  required DateTime date,
}) async {
  if (stopsToVisit(day).length < 2) return null;
  final double lat;
  final double lng;
  try {
    final here = await LocationService.getCurrentPosition();
    lat = here.latitude;
    lng = here.longitude;
  } on LocationDeniedException {
    return 'Turn on location so your route can be planned from where you are.';
  } catch (_) {
    return 'Your phone could not find where you are just now. Please try again.';
  }
  final plan = await planDay(
    day: day,
    lat: lat,
    lng: lng,
    google: (ids) => repo.googleVisitOrder(lat: lat, lng: lng, routeIds: ids),
  );
  if (plan != null) await repo.saveVisitPlan(repId, date, plan);
  return null;
}
