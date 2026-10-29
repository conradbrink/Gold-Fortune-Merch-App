import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/terms.dart';
import '../../features/driver/route_plan.dart';
import '../../features/route_today/visit_order.dart';
import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/route_visit.dart';
import '../models/store_group.dart';
import '../models/store_summary.dart';
import 'order_repository.dart' show clipText;
import 'route_plan_api.dart';

/// Trimmed, with runs of spaces collapsed: how `store_add_from_phone` tidies
/// a name and a town, and how this phone does before sending them.
String tidySpaces(String text) => text.trim().replaceAll(RegExp(r'\s+'), ' ');

/// The same, ignoring case: the rule this phone uses to ask "is this customer
/// on the list already?" before adding them.
String sameStoreName(String name) => tidySpaces(name).toLowerCase();

/// The customers already on the list called [name], by [sameStoreName].
List<StoreSummary> storesNamed(List<StoreSummary> stores, String name) {
  final wanted = sameStoreName(name);
  if (wanted.isEmpty) return const [];
  return stores.where((s) => sameStoreName(s.name) == wanted).toList();
}

/// The server's list with the customers this phone added and has not yet
/// seen come back, and the ids of those still waiting.
///
/// A customer added offline is only on this phone until `store_add` lands;
/// without this, the next refresh of the list would drop them and the rep
/// could not start a second visit there.
({List<StoreSummary> stores, List<StoreSummary> stillLocal}) mergeAddedStores(
  List<StoreSummary> fromServer,
  List<StoreSummary> added,
) {
  final known = {for (final s in fromServer) s.id};
  final stillLocal = added.where((s) => !known.contains(s.id)).toList();
  final all = [...fromServer, ...stillLocal]
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return (stores: all, stillLocal: stillLocal);
}

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

/// Layers a check-in the server has not heard about yet back over its stop.
///
/// While a check-in sits in the outbox the server's copy of that route has no
/// visit on it, so writing the fetched rows straight into the cache reverts the
/// stop to "not started" — and a rep who taps Check in again mints a second
/// client id and a duplicate visit. That is the exact failure
/// `VisitRepository.checkIn` writes into the cache to prevent, and a refresh
/// must not quietly undo it.
///
/// Only the visit fields are carried over, and only for stops whose client id
/// still has queued work: the route and the store stay the server's to change,
/// and once the entry drains the server's version is authoritative again.
List<RouteVisit> mergeUnsyncedLocalState({
  required List<RouteVisit> fromServer,
  required Map<String, RouteVisit> cached,
  required Set<String> pendingClientIds,
}) {
  if (pendingClientIds.isEmpty) return fromServer;

  return fromServer.map((server) {
    final local = cached[server.cacheKey];
    final clientId = local?.visitClientGeneratedId;
    if (local == null || clientId == null || !pendingClientIds.contains(clientId)) {
      return server;
    }
    return server.copyWith(
      status: local.status,
      visitClientGeneratedId: clientId,
      checkinAt: local.checkinAt,
      checkoutAt: local.checkoutAt,
    );
  }).toList();
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
  RouteRepository(this._client, this._db, {http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final SupabaseClient _client;
  final AppDatabase _db;
  final http.Client _http;

  static const _storesKey = 'stores';
  static const _addedStoresKey = 'stores_added';
  static const _storeGroupsKey = 'store_groups';
  static const _contactsKey = 'store_contacts';
  static const _visitPlanKey = 'visit_plan';

  static String formatDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-'
      '${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';

  /// Fetches from Supabase and refreshes the local cache. If the network is
  /// unavailable, falls back to the cached copy so the rep still sees their
  /// day. Local (unsynced) status changes are layered on top, and then the
  /// rep's plan for the day, when they have one ([inPlannedOrder]).
  Future<List<RouteVisit>> fetchRoutesForDate(
    String repId,
    DateTime date,
  ) async {
    final day = await _fetchRoutesForDate(repId, date);
    final plan = await savedVisitPlan(repId, date);
    return plan == null ? day : inPlannedOrder(day, plan.order);
  }

  /// [repId]'s plan for [date] ("Plan my route"), or null. Only one is
  /// kept: a plan is for the day it was made and the person who made it, so
  /// yesterday's, or a colleague's on a shared phone, is worth nothing.
  ///
  /// Never throws: the day must show without its plan rather than not at all.
  Future<RoutePlan?> savedVisitPlan(String repId, DateTime date) async {
    try {
      final raw = await _db.getValue(_visitPlanKey);
      if (raw == null) return null;
      final saved = jsonDecode(raw);
      if (saved is! Map<String, dynamic> ||
          saved['rep_id'] != repId ||
          saved['date'] != formatDate(date)) {
        return null;
      }
      return RoutePlan.fromMap(saved['plan']);
    } catch (_) {
      return null;
    }
  }

  /// Keeps [plan] as the order of [repId]'s stops still to visit on [date],
  /// on this phone only.
  Future<void> saveVisitPlan(String repId, DateTime date, RoutePlan plan) =>
      _db.setValue(
        _visitPlanKey,
        jsonEncode({
          'rep_id': repId,
          'date': formatDate(date),
          'plan': plan.toMap(),
        }),
      );

  /// Google's order for the rep's scheduled visits [routeIds] from ([lat],
  /// [lng]); null when there is none worth using.
  Future<RoutePlan?> googleVisitOrder({
    required double lat,
    required double lng,
    required List<String> routeIds,
  }) => googleRouteOrder(
    _client,
    _http,
    kind: PlanKind.visits,
    lat: lat,
    lng: lng,
    ids: routeIds,
  );

  Future<List<RouteVisit>> _fetchRoutesForDate(
    String repId,
    DateTime date,
  ) async {
    final dateStr = formatDate(date);

    try {
      // Taken before the request as well as after it. Checking out with
      // signal syncs straight away, so the check-out can leave the outbox
      // while this request is out — answered by a server that read the visit
      // before the update landed. Asked only afterwards, nothing was pending
      // any more, the server's "in progress" overwrote the cached check-out,
      // and Today's Route showed the stop as in progress until a
      // pull-to-refresh.
      final pendingBefore = await _db.pendingClientIds();
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

      final merged =
          await _keepingUnsyncedLocalState(visits, dateStr, pendingBefore);

      await _db.replaceCachedRoutes(
        dateStr,
        merged
            .map((v) => (cacheKey: v.cacheKey, payload: jsonEncode(v.toMap())))
            .toList(),
      );

      // Unscheduled visits live only on this device until they sync, so they
      // are merged in rather than coming back from the routes query.
      return _withAdHoc(_sorted(merged), dateStr);
    } catch (_) {
      return _cachedRoutes(dateStr);
    }
  }

  /// Loads what [mergeUnsyncedLocalState] needs, then applies it.
  ///
  /// [pendingBefore] is what was queued when the request went out; anything
  /// queued since is read here, so a check-in made meanwhile is kept too.
  Future<List<RouteVisit>> _keepingUnsyncedLocalState(
    List<RouteVisit> fromServer,
    String dateStr,
    Set<String> pendingBefore,
  ) async {
    final pending = {...pendingBefore, ...await _db.pendingClientIds()};
    if (pending.isEmpty) return fromServer;

    return mergeUnsyncedLocalState(
      fromServer: fromServer,
      cached: {
        for (final row in await _db.cachedRoutesForDate(dateStr))
          row.cacheKey: RouteVisit.fromMap(
              jsonDecode(row.payload) as Map<String, dynamic>),
      },
      pendingClientIds: pending,
    );
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
      // Once the server has a customer this phone added, the server's copy is
      // the one to keep. Read and pruned in one transaction, as
      // addStoreFromPhone writes it, so a customer added while this request
      // was out is not written over.
      return _db.transaction(() async {
        final merged = mergeAddedStores(stores, await _addedStores());
        await _saveAddedStores(merged.stillLocal);
        return merged.stores;
      });
    } catch (_) {
      final raw = await _db.getValue(_storesKey);
      final cached = raw == null
          ? <StoreSummary>[]
          : (jsonDecode(raw) as List)
              .map((s) => StoreSummary.fromMap(s as Map<String, dynamic>))
              .toList();
      return mergeAddedStores(cached, await _addedStores()).stores;
    }
  }

  Future<List<StoreSummary>> _addedStores() async {
    final raw = await _db.getValue(_addedStoresKey);
    if (raw == null) return [];
    return (jsonDecode(raw) as List)
        .map((s) => StoreSummary.fromMap(s as Map<String, dynamic>))
        .toList();
  }

  Future<void> _saveAddedStores(List<StoreSummary> stores) =>
      _db.setValue(_addedStoresKey, jsonEncode(stores.map((s) => s.toMap()).toList()));

  /// The company's price groups, cached for a rep adding a customer with no
  /// signal. Empty when the company has none, and the question is not asked.
  Future<List<StoreGroup>> fetchStoreGroups() async {
    try {
      final rows = await _client
          .from('store_groups')
          .select('id, name')
          .order('name', ascending: true);
      final groups = (rows as List)
          .map((r) => StoreGroup.fromMap(r as Map<String, dynamic>))
          .toList();
      await _db.setValue(
        _storeGroupsKey,
        jsonEncode(groups.map((g) => g.toMap()).toList()),
      );
      return groups;
    } catch (_) {
      final raw = await _db.getValue(_storeGroupsKey);
      if (raw == null) return [];
      return (jsonDecode(raw) as List)
          .map((g) => StoreGroup.fromMap(g as Map<String, dynamic>))
          .toList();
    }
  }

  /// Adds a customer the rep met in the field. On this phone at once, and
  /// queued for `store_add_from_phone()`, so the visit and the order that
  /// follow can be taken with no signal. Returns the customer as the picker
  /// lists it.
  Future<StoreSummary> addStoreFromPhone({
    required String storeId,
    required String repId,
    required String name,
    required String address,
    String? city,
    double? lat,
    double? lng,
    double? accuracyM,
    String? storeGroupId,
    StoreContact? contact,
  }) async {
    final tidyCity = city == null ? null : tidySpaces(city);
    final store = StoreSummary(
      id: storeId,
      name: clipText(tidySpaces(name), 120)!,
      address: clipText(address.trim(), 300),
      city: tidyCity == null || tidyCity.isEmpty ? null : clipText(tidyCity, 80),
      lat: lat,
      lng: lng,
      geocodeSource: lat == null ? null : 'rep',
      // What the server gives a store with no radius of its own; the company's
      // setting replaces it once the list refreshes.
      geofenceRadiusM: 100,
    );
    final payload = <String, dynamic>{
      'rep_id': repId,
      'store_id': storeId,
      'name': store.name,
      'address': store.address,
      'city': store.city,
      'lat': lat,
      'lng': lng,
      'accuracy_m': accuracyM,
      'store_group_id': storeGroupId,
    };
    await _db.transaction(() async {
      await _db.enqueue(
        entityType: OutboxType.storeAdd,
        clientGeneratedId: storeId,
        payload: jsonEncode(payload),
      );
      await _saveAddedStores([...await _addedStores(), store]);
      if (contact != null) await rememberContact(storeId, contact);
    });
    return store;
  }

  /// The contact this phone last took an order from at [storeId], if any.
  Future<StoreContact?> contactFor(String storeId) async {
    final one = (await _contacts())[storeId];
    return one is Map<String, dynamic> ? StoreContact.fromMap(one) : null;
  }

  Future<void> rememberContact(String storeId, StoreContact contact) async {
    final all = await _contacts();
    all[storeId] = contact.toMap();
    await _db.setValue(_contactsKey, jsonEncode(all));
  }

  /// Every remembered contact, by store. A value that does not read back is
  /// a convenience lost, not a reason to stop the order screen opening.
  Future<Map<String, dynamic>> _contacts() async {
    final raw = await _db.getValue(_contactsKey);
    if (raw == null) return {};
    try {
      final all = jsonDecode(raw);
      return all is Map<String, dynamic> ? all : {};
    } on FormatException {
      return {};
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
    // For the offline message, which is the phone's own.
    Terms terms = Terms.defaults,
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
      throw StoreLocationException(
        'You need a connection to set ${possessive(terms.site.withArticle)} '
        'location. Try again when you have signal — the '
        '${terms.site.oneLower} keeps its place on your list either way.',
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
