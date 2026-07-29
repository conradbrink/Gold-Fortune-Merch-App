import 'dart:convert';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../local/app_database.dart';
import '../models/route_visit.dart';
import '../models/store_summary.dart';

/// A refusal from `set_store_location_from_visit`, carrying a message written
/// for the rep to read rather than a Postgres error to decode.
class StoreLocationException implements Exception {
  final String message;
  const StoreLocationException(this.message);
  @override
  String toString() => message;
}

/// Orders a rep's day the way the planner laid it out.
///
/// This used to compare `scheduled_start_at`. The call cycle generates routes
/// without clock times, so that field is null on every route now: the sort was
/// comparing nothing against nothing and the stops came back in whatever order
/// the database happened to return, reshuffling between refreshes.
/// `sequence_order` is the field the planner actually writes.
///
/// Unscheduled visits have no sequence — the rep added them mid-day — so they
/// sit at the end. Store name breaks ties, which is arbitrary but stable, and
/// stable is the whole point: a list that reorders itself between refreshes
/// makes a rep lose their place in it.
int compareStops(RouteVisit a, RouteVisit b) {
  final aSeq = a.sequenceOrder;
  final bSeq = b.sequenceOrder;
  if (aSeq != bSeq) {
    if (aSeq == null) return 1;
    if (bSeq == null) return -1;
    return aSeq.compareTo(bSeq);
  }
  return a.storeName.toLowerCase().compareTo(b.storeName.toLowerCase());
}

/// Month-to-date progress against the rep's schedule.
class MonthlyCompletion {
  final int completed;
  final int total;

  const MonthlyCompletion({required this.completed, required this.total});

  double get fraction => total == 0 ? 0 : completed / total;
  int get percent => (fraction * 100).round();
}

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
            'id, store_id, sequence_order, scheduled_start_at, '
            'scheduled_end_at, '
            'stores(name, address, city, state, lat, lng, geocode_source, '
            'geofence_radius_m), '
            'visits(id, client_generated_id, status, checkin_at, checkout_at)',
          )
          .eq('rep_id', repId)
          .eq('scheduled_date', dateStr)
          // postgrest-dart's .order() defaults to DESCENDING — without the
          // flag the day renders latest-stop-first whenever it comes from the
          // server (the offline cache path sorts ascending, masking it).
          .order('sequence_order', ascending: true);

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
      return _withAdHoc(_sorted(visits), dateStr);
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

  List<RouteVisit> _sorted(List<RouteVisit> visits) {
    visits.sort(compareStops);
    return visits;
  }

  /// The org's active stores, cached so an unscheduled visit can be started
  /// with no connection.
  Future<List<StoreSummary>> fetchStores() async {
    try {
      final rows = await _client
          .from('stores')
          .select('id, name, address, city, state, lat, lng, geocode_source, '
              'geofence_radius_m')
          .eq('active', true)
          .order('name', ascending: true);

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

  /// Month-to-date schedule completion for the rep: how many of the routes
  /// scheduled from the 1st through today have a checked-out visit.
  ///
  /// This is the gamification metric — visit 90% of scheduled stores in the
  /// month to earn the reward. Unscheduled visits deliberately count neither
  /// for nor against it: the target is about covering the plan, and extra
  /// stores shouldn't let a rep skip planned ones. Checked-out is the bar
  /// (not checked-in) because that's when the work is actually done, and the
  /// recorded GPS distance keeps it honest.
  ///
  /// Cached per month so the summary screen still shows progress offline.
  /// Returns null when nothing is scheduled this month or nothing is cached.
  Future<MonthlyCompletion?> fetchMonthlyCompletion(String repId) async {
    final now = DateTime.now();
    final monthStart = formatDate(DateTime(now.year, now.month, 1));
    final today = formatDate(now);
    final cacheKey =
        'monthly_completion:$repId:${now.year}-${now.month.toString().padLeft(2, '0')}';

    try {
      final rows = await _client
          .from('routes')
          .select('id, visits(status)')
          .eq('rep_id', repId)
          .gte('scheduled_date', monthStart)
          .lte('scheduled_date', today);

      final total = (rows as List).length;
      if (total == 0) return null;

      final completed = rows.where((r) {
        final visits = r['visits'] as List? ?? [];
        return visits.any((v) =>
            (v as Map<String, dynamic>)['status'] == 'checked_out');
      }).length;

      final result = MonthlyCompletion(completed: completed, total: total);
      await _db.setValue(
          cacheKey, jsonEncode({'completed': completed, 'total': total}));
      return result;
    } catch (_) {
      final raw = await _db.getValue(cacheKey);
      if (raw == null) return null;
      final map = jsonDecode(raw) as Map<String, dynamic>;
      return MonthlyCompletion(
        completed: map['completed'] as int,
        total: map['total'] as int,
      );
    }
  }

  /// Records where the rep is standing as the store's location.
  ///
  /// Not queued through the outbox, unlike every other write here, and that is
  /// deliberate. The server refuses this for several good reasons — the store
  /// may have gained a location in the meantime, the fix may be too loose, the
  /// visit may not have synced — and a refusal a rep never sees is worse than
  /// no feature: they would walk away believing the shop was on the map. So it
  /// happens now, in front of them, or not at all.
  Future<void> setStoreLocationFromVisit({
    required String visitClientGeneratedId,
    required double lat,
    required double lng,
    required double accuracyM,
  }) async {
    try {
      await _client.rpc('set_store_location_from_visit', params: {
        'p_visit_client_id': visitClientGeneratedId,
        'p_lat': lat,
        'p_lng': lng,
        'p_accuracy_m': accuracyM,
      });
    } on PostgrestException catch (e) {
      // Every raise in that function is phrased for the rep.
      throw StoreLocationException(e.message);
    } on SocketException {
      throw const StoreLocationException(
        "You need a connection to set a store's location. Try again when you "
        'have signal — the shop keeps its place on your list either way.',
      );
    }
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
