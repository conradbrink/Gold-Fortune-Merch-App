import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../local/app_database.dart';
import '../models/route_visit.dart';
import '../models/store_summary.dart';

class RouteRepository {
  RouteRepository(this._client, this._db);

  final SupabaseClient _client;
  final AppDatabase _db;

  static const _storesKey = 'stores';

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
            .map((v) => (cacheKey: v.cacheKey, payload: jsonEncode(v.toMap())))
            .toList(),
      );

      // Unscheduled visits live only on this device until they sync, so they
      // are merged in rather than coming back from the routes query.
      return _withAdHoc(visits, dateStr);
    } catch (_) {
      return _cachedRoutes(dateStr);
    }
  }

  Future<List<RouteVisit>> _withAdHoc(
    List<RouteVisit> scheduled,
    String dateStr,
  ) async {
    final adHoc = await _db.adHocVisitsForDate(dateStr);
    if (adHoc.isEmpty) return scheduled;

    // A synced ad-hoc visit comes back inside the routes query only if the
    // manager later scheduled it; otherwise the local copy stays the record.
    final seen = scheduled.map((v) => v.visitClientGeneratedId).toSet();
    final extras = adHoc
        .map((c) =>
            RouteVisit.fromMap(jsonDecode(c.payload) as Map<String, dynamic>))
        .where((v) => !seen.contains(v.visitClientGeneratedId));

    return _sorted([...scheduled, ...extras]);
  }

  Future<List<RouteVisit>> _cachedRoutes(String dateStr) async {
    final cached = await _db.cachedRoutesForDate(dateStr);
    return _sorted(cached
        .map((c) =>
            RouteVisit.fromMap(jsonDecode(c.payload) as Map<String, dynamic>))
        .toList());
  }

  /// Scheduled visits sort by their slot; unscheduled ones have no slot, so
  /// they sit at the end of the day's list.
  List<RouteVisit> _sorted(List<RouteVisit> visits) {
    visits.sort((a, b) {
      final aStart = a.scheduledStartAt;
      final bStart = b.scheduledStartAt;
      if (aStart == null && bStart == null) return 0;
      if (aStart == null) return 1;
      if (bStart == null) return -1;
      return aStart.compareTo(bStart);
    });
    return visits;
  }

  /// The org's active stores, cached so an unscheduled visit can be started
  /// with no connection.
  Future<List<StoreSummary>> fetchStores() async {
    try {
      final rows = await _client
          .from('stores')
          .select('id, name, address, city, state, lat, lng, geofence_radius_m')
          .eq('active', true)
          .order('name');

      final stores = (rows as List)
          .map((r) => StoreSummary.fromMap(r as Map<String, dynamic>))
          .toList();

      await _db.setValue(
        _storesKey,
        jsonEncode(stores.map((s) => s.toMap()).toList()),
      );
      return stores;
    } catch (_) {
      final raw = await _db.getValue(_storesKey);
      if (raw == null) return [];
      return (jsonDecode(raw) as List)
          .map((s) => StoreSummary.fromMap(s as Map<String, dynamic>))
          .toList();
    }
  }

  /// Records an unscheduled visit locally so it appears on the day's list
  /// immediately, before check-in and before any connection.
  Future<void> addUnscheduledVisit(RouteVisit visit, DateTime date) {
    return _db.insertAdHocVisit(
      cacheKey: visit.cacheKey,
      scheduledDate: formatDate(date),
      payload: jsonEncode(visit.toMap()),
    );
  }

  /// Applies a local status change immediately so the UI reflects an offline
  /// check-in/out without waiting for the server.
  Future<void> applyLocalVisitChange(RouteVisit updated) async {
    await _db.updateCachedRoute(
      updated.cacheKey,
      jsonEncode(updated.toMap()),
    );
  }
}
