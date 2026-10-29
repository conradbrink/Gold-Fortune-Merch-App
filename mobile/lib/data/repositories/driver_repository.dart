import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../features/driver/route_plan.dart';
import 'route_plan_api.dart';

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

  /// Google's order for [dispatchIds] from ([lat], [lng]); null when there
  /// is none worth using, and the caller orders them nearest first.
  Future<RoutePlan?> googleOrder({
    required double lat,
    required double lng,
    required List<String> dispatchIds,
  }) => googleRouteOrder(
    _client,
    _http,
    kind: PlanKind.deliveries,
    lat: lat,
    lng: lng,
    ids: dispatchIds,
  );
}
