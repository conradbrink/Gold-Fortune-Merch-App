import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../features/driver/route_plan.dart';

/// A driver's round: the deliveries given to them, and the order to drive
/// them in.
///
/// Like [DeliveryRepository], nothing here filters by person: RLS
/// (`dispatches_select`) answers with only the dispatches assigned to the
/// signed-in login. Online only, for the same reason as "My deliveries": a
/// round from yesterday's cache would send a driver to a shop the warehouse
/// has since taken off it.
class DriverRepository {
  DriverRepository(this._client, {http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final SupabaseClient _client;
  final http.Client _http;

  /// The delivery list's columns, plus where each place is and its town and
  /// territory. `stores_territory_id_fkey` is named because `stores` points at
  /// `territories` twice (territory and sub-territory).
  static const _select = '''
id, dispatch_number, status, dispatched_at, expected_delivery_on, delivered_at,
carrier_name, tracking_reference,
order:orders(order_number, delivery_address,
  store:stores(name, address, city, state, lat, lng,
    territory:territories!stores_territory_id_fkey(name))),
lines:dispatch_lines(qty)
''';

  /// Everything still on the road, and what was finished in the last week so
  /// the driver sees today's drops ticked off.
  Future<List<RunStop>> myRun({DateTime? now}) async {
    final since = (now ?? DateTime.now())
        .subtract(const Duration(days: 7))
        .toUtc()
        .toIso8601String();
    final rows = await _client
        .from('dispatches')
        .select(_select)
        .or('status.eq.in_transit,delivered_at.gte.$since')
        .order('dispatched_at', ascending: false)
        .limit(200);
    return [
      for (final r in rows as List) RunStop.fromMap(r as Map<String, dynamic>),
    ];
  }

  /// Google's order for [dispatchIds] from ([lat], [lng]), through the web's
  /// `/api/route-plan` (the Google key stays on the server). Null when there
  /// is no answer worth using — no signal, route planning not switched on,
  /// too many stops, anything — and the caller orders them nearest first.
  Future<RoutePlan?> googleOrder({
    required double lat,
    required double lng,
    required List<String> dispatchIds,
  }) async {
    final token = _client.auth.currentSession?.accessToken;
    if (token == null || dispatchIds.length < 2) return null;
    try {
      // No network, no wait: the straight-line plan needs none.
      final links = await Connectivity().checkConnectivity();
      if (links.contains(ConnectivityResult.none)) return null;
      final res = await _http
          .post(
            Uri.parse('${Env.webBaseUrl}/api/route-plan'),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'origin': {'lat': lat, 'lng': lng},
              'dispatchIds': dispatchIds,
            }),
          )
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return null;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final order = (body['order'] as List?)?.whereType<String>().toList();
      // Every stop, once: an answer that loses one is worse than nearest
      // first, which never does.
      if (order == null ||
          order.length != dispatchIds.length ||
          order.toSet().length != order.length ||
          !order.every(dispatchIds.contains)) {
        return null;
      }
      return RoutePlan(
        order: order,
        byGoogle: true,
        distanceMeters: (body['distanceMeters'] as num?)?.toInt(),
        durationSeconds: (body['durationSeconds'] as num?)?.toInt(),
      );
    } catch (_) {
      return null;
    }
  }
}
