// A check-out must still show on Today's Route when it syncs while the day is
// being fetched.
//
// With signal it did not. Checking out queues the update and syncs at once,
// and the screen asks for the day at the same moment. When the server read
// the visit before the update landed, and the update then drained before the
// reply came back, the merge found nothing pending and wrote the server's
// "in progress" over the cached check-out. The stop stayed IN PROGRESS until
// the rep pulled to refresh.
//
// A real `SupabaseClient` over a fake PostgREST; the sync landing mid-request
// is the handler changing the outbox before it replies.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/route_visit.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final day = DateTime(2026, 10, 26);

RouteVisit stop({required String status, DateTime? checkoutAt}) => RouteVisit(
  routeId: 'route-1',
  storeId: 'store-1',
  storeName: 'Choppies Kgale',
  geofenceRadiusM: 100,
  sequenceOrder: 1,
  visitClientGeneratedId: 'visit-1',
  status: status,
  checkinAt: DateTime.utc(2026, 10, 26, 8, 0),
  checkoutAt: checkoutAt,
);

void main() {
  late AppDatabase db;
  late SupabaseClient client;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await client.dispose();
    await db.close();
  });

  /// The server still has the visit checked in. [onRequest] runs while the
  /// request is out, where a sync landing at the same moment would.
  RouteRepository repoOver({required Future<void> Function() onRequest}) {
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        await onRequest();
        // The request rides along: postgrest reads `response.request!`.
        return http.Response(
          jsonEncode([stop(status: 'checked_in').toMap()]),
          200,
          headers: {'content-type': 'application/json'},
          request: request,
        );
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return RouteRepository(client, db);
  }

  /// What `VisitRepository` leaves behind: the stop cached as [local], with
  /// [type] queued for its visit.
  Future<int> actLocally(RouteVisit local, String type) async {
    await db.replaceCachedRoutes('rep-1', RouteRepository.formatDate(day), [
      (cacheKey: local.cacheKey, payload: jsonEncode(local.toMap())),
    ]);
    return db.enqueue(
      entityType: type,
      clientGeneratedId: 'visit-1',
      payload: '{}',
    );
  }

  Future<String> cachedStatus() async {
    final rows = await db.cachedRoutesForDate(
      'rep-1',
      RouteRepository.formatDate(day),
    );
    return RouteVisit.fromMap(
      jsonDecode(rows.single.payload) as Map<String, dynamic>,
    ).status;
  }

  test('a check-out that syncs during the fetch stays checked out', () async {
    final checkedOut = stop(
      status: 'checked_out',
      checkoutAt: DateTime.utc(2026, 10, 26, 8, 20),
    );
    final id = await actLocally(checkedOut, OutboxType.visitCheckOut);

    final routes = await repoOver(
      onRequest: () => db.deleteEntry(id),
    ).fetchRoutesForDate('rep-1', day);

    expect(routes.single.status, 'checked_out');
    // And the cache, which every later offline read renders from.
    expect(await cachedStatus(), 'checked_out');
  });

  test('a check-out queued during the fetch is kept as well', () async {
    // The other half: work queued while the request is out was never in the
    // first read, and must still not be overwritten.
    final checkedOut = stop(
      status: 'checked_out',
      checkoutAt: DateTime.utc(2026, 10, 26, 8, 20),
    );
    final routes = await repoOver(
      onRequest: () => actLocally(checkedOut, OutboxType.visitCheckOut),
    ).fetchRoutesForDate('rep-1', day);

    expect(routes.single.status, 'checked_out');
  });

  test('with nothing queued the server is believed', () async {
    // A check-out that drained well before the fetch: the server has it, and
    // a cache saying otherwise is the stale side.
    await db.replaceCachedRoutes('rep-1', RouteRepository.formatDate(day), [
      (cacheKey: 'route-1', payload: jsonEncode(stop(status: 'checked_out').toMap())),
    ]);

    final routes = await repoOver(
      onRequest: () async {},
    ).fetchRoutesForDate('rep-1', day);

    expect(routes.single.status, 'checked_in');
  });
}
