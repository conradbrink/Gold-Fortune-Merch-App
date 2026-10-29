// Two reps on one phone: what the first leaves behind must not turn up on the
// second one's day.
//
// Seen on 29 Oct 2026 on a test phone: Thabo added two unscheduled visits,
// signed out, Sipho signed in, and Sipho's Today's Route listed both of them,
// with "1 change waiting to sync" that Sipho could never send. The day was
// cached by date alone, and the count was everyone's.

import 'dart:convert';

import 'package:drift/drift.dart' show Variable;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/lead.dart';
import 'package:gf_merch_rep/data/models/route_visit.dart';
import 'package:gf_merch_rep/data/repositories/lead_repository.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final day = DateTime(2026, 10, 29);
final dateStr = RouteRepository.formatDate(day);

RouteVisit unscheduled(String clientId, String storeName) =>
    RouteVisit.unscheduled(
      clientId: clientId,
      storeId: 'store-$clientId',
      storeName: storeName,
      geofenceRadiusM: 100,
    );

RouteVisit scheduled(String routeId, String storeName) => RouteVisit(
  routeId: routeId,
  storeId: 'store-$routeId',
  storeName: storeName,
  geofenceRadiusM: 100,
  sequenceOrder: 1,
  status: 'not_started',
);

void main() {
  late AppDatabase db;
  SupabaseClient? client;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await client?.dispose();
    client = null;
    await db.close();
  });

  /// A server that answers each rep with [days] (nobody's day is empty), or
  /// fails every fetch when [offline].
  RouteRepository repo({
    Map<String, List<RouteVisit>> days = const {},
    bool offline = false,
  }) {
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        // Any failed fetch falls back to the cache. A plain refusal: a
        // dropped connection or a 5xx is retried for seconds first.
        if (offline) {
          return http.Response(
            jsonEncode({'message': 'unreachable', 'code': 'PGRST000'}),
            400,
            headers: {'content-type': 'application/json'},
            request: request,
          );
        }
        final repId = request.url.queryParameters['rep_id']!.substring(3);
        return http.Response(
          jsonEncode([for (final v in days[repId] ?? const []) v.toMap()]),
          200,
          headers: {'content-type': 'application/json'},
          request: request,
        );
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return RouteRepository(client!, db);
  }

  List<String> names(List<RouteVisit> visits) =>
      visits.map((v) => v.storeName).toList();

  group('unscheduled visits', () {
    test('stay with the rep who added them after a sign-in switch', () async {
      final r = repo();
      await r.addUnscheduledVisit(
        'thabo',
        unscheduled('v1', 'Bloem Corner Tuck Shop'),
        day,
      );
      await r.addUnscheduledVisit(
        'thabo',
        unscheduled('v2', 'Offline Test Spaza'),
        day,
      );

      // Thabo signs out; Sipho signs in on the same phone.
      expect(await r.fetchRoutesForDate('sipho', day), isEmpty);

      // And Thabo's are still there when he comes back.
      expect(names(await r.fetchRoutesForDate('thabo', day)), [
        'Bloem Corner Tuck Shop',
        'Offline Test Spaza',
      ]);
    });

    test('stay with their rep offline too', () async {
      await repo().addUnscheduledVisit(
        'thabo',
        unscheduled('v1', 'Bloem Corner Tuck Shop'),
        day,
      );

      final offline = repo(offline: true);
      expect(await offline.fetchRoutesForDate('sipho', day), isEmpty);
      expect(names(await offline.fetchRoutesForDate('thabo', day)), [
        'Bloem Corner Tuck Shop',
      ]);
    });
  });

  group('the cached schedule', () {
    test("one rep's refresh keeps the other's day for offline", () async {
      final online = repo(
        days: {
          'thabo': [scheduled('route-t', 'Choppies Kgale')],
          'sipho': [scheduled('route-s', 'Spar Rosebank')],
        },
      );
      await online.fetchRoutesForDate('thabo', day);
      await online.fetchRoutesForDate('sipho', day);

      final offline = repo(offline: true);
      expect(names(await offline.fetchRoutesForDate('thabo', day)), [
        'Choppies Kgale',
      ]);
      expect(names(await offline.fetchRoutesForDate('sipho', day)), [
        'Spar Rosebank',
      ]);
    });
  });

  group('the waiting-to-sync count', () {
    Future<void> queue(
      String type,
      String clientId,
      Map<String, dynamic> payload,
    ) => db.enqueue(
      entityType: type,
      clientGeneratedId: clientId,
      payload: jsonEncode(payload),
    );

    test(
      "counts only the signed-in person's work, and work that names nobody",
      () async {
        await queue(OutboxType.visitCheckIn, 'v1', {'rep_id': 'thabo'});
        await queue(OutboxType.visitCheckOut, 'v1', {'rep_id': 'thabo'});
        await queue(OutboxType.visitCheckIn, 'v3', {'rep_id': 'sipho'});
        await queue(OutboxType.locationPing, 'p1', {});

        expect(await db.watchPendingCountFor('sipho').first, 2);
        expect(await db.watchPendingCountFor('thabo').first, 3);
        expect(await db.watchPendingCountFor('nobody').first, 1);
        // Everyone's together is still what the phone holds.
        expect(await db.watchPendingCount().first, 4);
      },
    );

    test('a payload that is not JSON is counted, not a crash', () async {
      await db.enqueue(
        entityType: OutboxType.visitCheckIn,
        clientGeneratedId: 'x',
        payload: 'not json',
      );
      expect(await db.watchPendingCountFor('sipho').first, 1);
    });
  });

  group('sales visits', () {
    Lead call(String id, String repId, {String status = 'in_progress'}) => Lead(
      clientGeneratedId: id,
      orgId: 'org-1',
      repId: repId,
      companyName: 'Call $id',
      purpose: 'Listing',
      startedAt: DateTime(2026, 10, 29, 9),
      status: status,
    );

    test("the next person is not offered the last one's open call", () async {
      // As LeadRepository caches them: one list, whoever used the phone.
      await db.setValue(
        'leads',
        jsonEncode([
          call('c1', 'thabo').toMap(),
          call('c2', 'sipho', status: 'completed').toMap(),
        ]),
      );
      client = SupabaseClient(
        'http://localhost:54321',
        'anon-key',
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      final leads = LeadRepository(
        db,
        SyncEngine(db, client!, readBuild: () async => null),
      );

      expect(
        (await leads.inProgress('sipho')).map((l) => l.clientGeneratedId),
        isEmpty,
      );
      expect((await leads.myLeads('sipho')).map((l) => l.clientGeneratedId), [
        'c2',
      ]);
      expect(
        (await leads.inProgress('thabo')).map((l) => l.clientGeneratedId),
        ['c1'],
      );
    });
  });

  group('the sync status', () {
    test("counts the signed-in person's work, not the last person's", () async {
      await db.enqueue(
        entityType: OutboxType.visitCheckIn,
        clientGeneratedId: 'v1',
        payload: jsonEncode({'rep_id': 'thabo'}),
      );
      client = SupabaseClient(
        'http://localhost:54321',
        'anon-key',
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      // Sipho is signed in: Thabo's check-in is held for him, never sent.
      final engine = SyncEngine(
        db,
        client!,
        readBuild: () async => null,
        signedInUser: () => 'sipho',
      );
      final statuses = <SyncStatus>[];
      final sub = engine.status.listen(statuses.add);
      await engine.sync();
      await Future<void>.delayed(Duration.zero);
      await sub.cancel();
      engine.dispose();

      expect(statuses, isNotEmpty);
      expect(statuses.map((s) => s.pending), everyElement(0));
      // Still on the phone, waiting for Thabo.
      expect(await db.watchPendingCount().first, 1);
    });
  });

  group('upgrading from schema 4', () {
    // The phone's database as 1.2.6 left it: the day cached by date alone.
    AppDatabase schema4({required void Function(dynamic raw) rows}) {
      return AppDatabase.forTesting(
        NativeDatabase.memory(
          setup: (raw) {
            raw.execute('''
          CREATE TABLE outbox_entries (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL, payload TEXT NOT NULL,
            client_generated_id TEXT NOT NULL, created_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NULL)''');
            raw.execute('''
          CREATE TABLE cached_routes (
            route_id TEXT NOT NULL, scheduled_date TEXT NOT NULL,
            payload TEXT NOT NULL, cached_at INTEGER NOT NULL,
            ad_hoc INTEGER NOT NULL DEFAULT 0 CHECK ("ad_hoc" IN (0, 1)),
            PRIMARY KEY (route_id))''');
            raw.execute('''
          CREATE TABLE key_value_entries (
            key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (key))''');
            raw.execute('''
          CREATE TABLE cached_files (
            file_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NULL,
            storage_path TEXT NOT NULL, mime_type TEXT NULL,
            size_bytes INTEGER NULL, local_path TEXT NULL,
            updated_at INTEGER NOT NULL, cached_at INTEGER NOT NULL,
            PRIMARY KEY (file_id))''');
            rows(raw);
            raw.execute('PRAGMA user_version = 4');
          },
        ),
      );
    }

    void cacheRow(dynamic raw, RouteVisit v, {required bool adHoc}) {
      raw.execute('INSERT INTO cached_routes VALUES (?, ?, ?, 0, ?)', [
        v.cacheKey,
        dateStr,
        jsonEncode(v.toMap()),
        adHoc ? 1 : 0,
      ]);
    }

    test('an unscheduled visit with queued work goes to its rep', () async {
      await db.close();
      db = schema4(
        rows: (raw) {
          for (final (id, name) in [
            ('v1', 'Bloem Corner Tuck Shop'),
            ('v2', 'Offline Test Spaza'),
            ('v3', 'Batho Cash Store'),
            ('v4', 'Bayswater Superette'),
          ]) {
            cacheRow(raw, unscheduled(id, name), adHoc: true);
          }
          cacheRow(raw, scheduled('route-1', 'Choppies Kgale'), adHoc: false);
          void queue(String type, String clientId, Map<String, dynamic> p) =>
              raw.execute(
                'INSERT INTO outbox_entries '
                '(entity_type, payload, client_generated_id, created_at) '
                'VALUES (?, ?, ?, 0)',
                [type, jsonEncode(p), clientId],
              );
          // A check-in still waiting.
          queue(OutboxType.visitCheckIn, 'v1', {'rep_id': 'thabo'});
          // The check-in landed; the check-out, keyed by the visit, did not.
          queue(OutboxType.visitCheckOut, 'v3', {'rep_id': 'sipho'});
          // Only a form names the visit, by its own id.
          queue(OutboxType.formSubmission, 'form-1', {
            'rep_id': 'naledi',
            'visit_client_generated_id': 'v4',
          });
        },
      );

      final owners = {
        for (final row
            in await db
                .customSelect('SELECT route_id, rep_id FROM cached_routes')
                .get())
          row.read<String>('route_id'): row.readNullable<String>('rep_id'),
      };
      expect(owners, {
        'v1': 'thabo',
        'v2': null,
        'v3': 'sipho',
        'v4': 'naledi',
        'route-1': null,
      });
    });

    test('a new install has nothing to claim', () async {
      await repo().addUnscheduledVisit('thabo', unscheduled('v1', 'Spar'), day);
      expect(await db.claimUnownedRoutes('sipho'), 0);
    });

    test(
      'the rest go to the first person to read the day, and only once',
      () async {
        await db.close();
        db = schema4(
          rows: (raw) {
            cacheRow(raw, unscheduled('v2', 'Offline Test Spaza'), adHoc: true);
            cacheRow(raw, scheduled('route-1', 'Choppies Kgale'), adHoc: false);
          },
        );

        // Still signed in across the update: their day, offline, is intact.
        final offline = repo(offline: true);
        expect(names(await offline.fetchRoutesForDate('thabo', day)), [
          'Choppies Kgale',
          'Offline Test Spaza',
        ]);
        // Whoever signs in after them does not inherit it.
        expect(await offline.fetchRoutesForDate('sipho', day), isEmpty);
        expect(
          await db
              .customSelect(
                'SELECT COUNT(*) AS c FROM cached_routes WHERE rep_id = ?',
                variables: [Variable<String>('thabo')],
              )
              .map((r) => r.read<int>('c'))
              .getSingle(),
          2,
        );
      },
    );
  });
}
