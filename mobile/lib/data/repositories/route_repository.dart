import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../local/app_database.dart';
import '../models/route_visit.dart';

class RouteRepository {
  RouteRepository(this._client, this._db);

  final SupabaseClient _client;
  final AppDatabase _db;

  static String formatDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  /// Fetches from Supabase and refreshes the local cache. If the network is
  /// unavailable, falls back to the cached copy so the rep still sees their
  /// day. Local (unsynced) status changes are layered on top.
  Future<List<RouteVisit>> fetchRoutesForDate(
    String repId,
    DateTime date,
  ) async {
    final dateStr = formatDate(date);

    try {
      final rows = await _client
          .from('routes')
          .select(
            'id, store_id, scheduled_start_at, scheduled_end_at, '
            'stores(name, address, city, state, lat, lng, geofence_radius_m), '
            'visits(id, client_generated_id, status, checkin_at, checkout_at)',
          )
          .eq('rep_id', repId)
          .eq('scheduled_date', dateStr)
          .order('scheduled_start_at');

      final visits = (rows as List)
          .map((r) => RouteVisit.fromMap(r as Map<String, dynamic>))
          .toList();

      await _db.replaceCachedRoutes(
        dateStr,
        visits
            .map((v) => (routeId: v.routeId, payload: jsonEncode(v.toMap())))
            .toList(),
      );

      return visits;
    } catch (_) {
      return _cachedRoutes(dateStr);
    }
  }

  Future<List<RouteVisit>> _cachedRoutes(String dateStr) async {
    final cached = await _db.cachedRoutesForDate(dateStr);
    final visits = cached
        .map((c) =>
            RouteVisit.fromMap(jsonDecode(c.payload) as Map<String, dynamic>))
        .toList();
    visits.sort((a, b) {
      final aStart = a.scheduledStartAt;
      final bStart = b.scheduledStartAt;
      if (aStart == null || bStart == null) return 0;
      return aStart.compareTo(bStart);
    });
    return visits;
  }

  /// Applies a local status change immediately so the UI reflects an offline
  /// check-in/out without waiting for the server.
  Future<void> applyLocalVisitChange(RouteVisit updated) async {
    await _db.updateCachedRoute(
      updated.routeId,
      jsonEncode(updated.toMap()),
    );
  }
}
