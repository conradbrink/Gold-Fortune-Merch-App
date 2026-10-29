import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../features/driver/route_plan.dart';

/// Which stops `/api/route-plan` is asked to order: a driver's deliveries or
/// a rep's scheduled visits. The server reads each kind through the caller's
/// own login, so nobody can plan a stop that is not theirs.
enum PlanKind {
  deliveries('dispatchIds'),
  visits('routeIds');

  const PlanKind(this.field);

  /// The body field the server reads the ids from.
  final String field;
}

/// Google's order for [ids] from ([lat], [lng]), through the web's
/// `/api/route-plan` (the Google key stays on the server). Null when there is
/// no answer worth using — no signal, route planning not switched on, the
/// day's limit reached, too many stops, anything — and the caller orders them
/// nearest first.
Future<RoutePlan?> googleRouteOrder(
  SupabaseClient client,
  http.Client httpClient, {
  required PlanKind kind,
  required double lat,
  required double lng,
  required List<String> ids,
}) async {
  final token = client.auth.currentSession?.accessToken;
  if (token == null || ids.length < 2) return null;
  try {
    // No network, no wait: the straight-line plan needs none.
    final links = await Connectivity().checkConnectivity();
    if (links.contains(ConnectivityResult.none)) return null;
    final res = await httpClient
        .post(
          Uri.parse('${Env.webBaseUrl}/api/route-plan'),
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({
            'origin': {'lat': lat, 'lng': lng},
            kind.field: ids,
          }),
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) return null;
    return planFromAnswer(jsonDecode(res.body), ids);
  } catch (_) {
    return null;
  }
}

/// The server's answer read into a plan. Every stop, once: an answer that
/// loses one is worse than nearest first, which never does.
RoutePlan? planFromAnswer(Object? body, List<String> ids) {
  if (body is! Map<String, dynamic>) return null;
  final order = (body['order'] as List?)?.whereType<String>().toList();
  if (order == null ||
      order.length != ids.length ||
      order.toSet().length != order.length ||
      !order.every(ids.contains)) {
    return null;
  }
  return RoutePlan(
    order: order,
    byGoogle: true,
    distanceMeters: (body['distanceMeters'] as num?)?.toInt(),
    durationSeconds: (body['durationSeconds'] as num?)?.toInt(),
  );
}
