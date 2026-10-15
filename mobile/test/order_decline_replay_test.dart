// Why a store did not order is one insert into `order_declines`, written from
// the outbox. The table has an INSERT policy and no UPDATE policy, and keeps
// one reason per visit, so a retry and a second answer must both end quietly
// rather than hold the queue.
//
// A real `SupabaseClient` over a fake PostgREST, as in order_replay_test.dart.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _json = {'content-type': 'application/json'};

http.Response _answer(http.Request request, Object body, int status) =>
    http.Response(jsonEncode(body), status, headers: _json, request: request);

void main() {
  late AppDatabase db;
  late SupabaseClient client;
  late List<http.Request> requests;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    requests = [];
  });

  tearDown(() async {
    await client.dispose();
    await db.close();
  });

  SyncEngine engineAnswering(int status, Object body) {
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        requests.add(request);
        if (request.url.path.endsWith('/order_declines')) {
          return _answer(request, body, status);
        }
        return http.Response('unexpected ${request.url.path}', 500, request: request);
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return SyncEngine(db, client, readBuild: () async => null, signedInUser: () => 'rep-1');
  }

  Future<void> queueDecline() => db.enqueue(
        entityType: OutboxType.orderDecline,
        clientGeneratedId: 'decline-1',
        payload: jsonEncode({
          'org_id': 'org-1',
          'rep_id': 'rep-1',
          'store_id': 'store-1',
          'visit_client_generated_id': 'visit-1',
          'client_generated_id': 'decline-1',
          'reason': 'has_stock',
          'note': null,
          'created_at': '2026-10-15T10:00:00.000Z',
        }),
      );

  Future<List<OutboxEntry>> pending() => db.pendingEntries(maxAttempts: kMaxAttempts);

  test('a reason is inserted once, and a retry meets its own row quietly', () async {
    await queueDecline();
    await engineAnswering(201, []).sync();

    expect(await pending(), isEmpty);
    final post = requests.single;
    expect(post.method, 'POST');
    expect(post.url.queryParameters['on_conflict'], 'client_generated_id');
    expect(post.headers['Prefer'], contains('resolution=ignore-duplicates'));
    final body = jsonDecode(post.body);
    final row = body is List ? body.single : body;
    expect(row['reason'], 'has_stock');
    expect(row['visit_client_generated_id'], 'visit-1');
  });

  test('a visit that already has a reason is done, not retried', () async {
    await queueDecline();
    await engineAnswering(409, {
      'code': '23505',
      'message': 'duplicate key value violates unique constraint "order_declines_visit_key"',
      'details': null,
      'hint': null,
    }).sync();

    expect(await pending(), isEmpty);
  });

  test('a refusal is kept and retried', () async {
    await queueDecline();
    await engineAnswering(403, {
      'code': '42501',
      'message': 'new row violates row-level security policy for table "order_declines"',
      'details': 'Forbidden',
      'hint': null,
    }).sync();

    expect(await pending(), hasLength(1));
  });
}
