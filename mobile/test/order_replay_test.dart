// An order the rep took is two writes: the header, then its lines. Between
// them sits an RLS policy that admits a line only while the order is `new`.
//
// Four orders taken on 1.1.3 landed as headers with no lines, the warehouse
// finished them by hand — typed the lines and delivered, or cancelled — and the
// entries stayed on two reps' phones. Every new build re-armed them: eight
// refused inserts each, a Sentry report each, and the whole outbox waited
// behind them for half an hour after every install (FLUTTER-8 on 1.1.10).
//
// A real `SupabaseClient` over a fake PostgREST, so what is asserted is the
// request the phone actually sends, not a stub of it.

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

typedef Answer = http.Response Function(http.Request request);

/// A JSON body. The request rides along because postgrest reads
/// `response.request!` when it parses, and `MockClient` leaves it null.
Answer ok(Object body, {int status = 200}) =>
    (request) => http.Response(
      jsonEncode(body),
      status,
      headers: _json,
      request: request,
    );

/// PostgREST's shape for a policy refusal.
Answer refused(String table) => ok({
  'code': '42501',
  'message': 'new row violates row-level security policy for table "$table"',
  'details': 'Forbidden',
  'hint': null,
}, status: 403);

class FakePostgrest {
  FakePostgrest({required this.existingOrder, this.linesResponse});

  /// What `orders?client_generated_id=eq.…` returns: null for "not there".
  final Map<String, dynamic>? existingOrder;
  final Answer? linesResponse;

  final requests = <http.Request>[];

  http.Client get client => MockClient((request) async {
    requests.add(request);
    final path = request.url.path;
    if (path.endsWith('/orders') && request.method == 'GET') {
      return ok([if (existingOrder != null) existingOrder])(request);
    }
    if (path.endsWith('/rpc/next_document_number')) {
      return ok('SO-000200')(request);
    }
    if (path.endsWith('/orders') && request.method == 'POST') {
      return ok({'id': 'order-new'}, status: 201)(request);
    }
    if (path.endsWith('/order_lines')) {
      return (linesResponse ?? ok([], status: 201))(request);
    }
    return http.Response('unexpected $path', 500, request: request);
  });

  Iterable<http.Request> to(String table) =>
      requests.where((r) => r.url.path.endsWith('/$table'));
}

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

  SyncEngine engineOver(FakePostgrest server, {String? signedIn = 'rep-1'}) {
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: server.client,
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return SyncEngine(
      db,
      client,
      readBuild: () async => null,
      signedInUser: () => signedIn,
    );
  }

  Future<int> queueOrder() => db.enqueue(
    entityType: OutboxType.orderCreate,
    clientGeneratedId: 'order-abc',
    payload: jsonEncode({
      'org_id': 'org-1',
      'rep_id': 'rep-1',
      'store_id': 'store-1',
      'client_generated_id': 'order-abc',
      'lines': [
        {
          'product_id': 'prod-1',
          'qty_ordered': 12,
          'unit_price': null,
          'client_generated_id': 'line-1',
        },
      ],
    }),
  );

  Future<List<OutboxEntry>> pending() =>
      db.pendingEntries(maxAttempts: kMaxAttempts);

  test('an order the warehouse has already dealt with is finished', () async {
    final server = FakePostgrest(
      existingOrder: {'id': 'order-1', 'status': 'cancelled'},
    );
    await queueOrder();

    await engineOver(server).sync();

    expect(
      await pending(),
      isEmpty,
      reason: 'the entry is satisfied, not stalled',
    );
    expect(
      server.to('order_lines'),
      isEmpty,
      reason: 'no line is offered to an order the policy would refuse',
    );
    expect(
      server.to('rpc/next_document_number'),
      isEmpty,
      reason: 'and no order number is drawn for it',
    );
  });

  test('a delivered order is finished the same way', () async {
    final server = FakePostgrest(
      existingOrder: {'id': 'order-1', 'status': 'delivered'},
    );
    await queueOrder();

    await engineOver(server).sync();

    expect(await pending(), isEmpty);
    expect(server.to('order_lines'), isEmpty);
  });

  test('a header that landed without its lines still gets them', () async {
    final server = FakePostgrest(
      existingOrder: {'id': 'order-1', 'status': 'new'},
    );
    await queueOrder();

    await engineOver(server).sync();

    expect(await pending(), isEmpty);
    expect(
      server.to('orders').where((r) => r.method == 'POST'),
      isEmpty,
      reason: 'the header is not written twice',
    );
    final lines = server.to('order_lines').single;
    expect(
      lines.headers['Prefer'],
      contains('resolution=ignore-duplicates'),
      reason: 'a retry that meets its own line must do nothing, not update',
    );
    final sent = (jsonDecode(lines.body) as List).single as Map;
    expect(sent['order_id'], 'order-1');
    expect(sent['org_id'], 'org-1');
    expect(sent['client_generated_id'], 'line-1');
  });

  test('an order not yet on the server is written header first', () async {
    final server = FakePostgrest(existingOrder: null);
    await queueOrder();

    await engineOver(server).sync();

    expect(await pending(), isEmpty);
    final header = server.to('orders').singleWhere((r) => r.method == 'POST');
    final body = jsonDecode(header.body) as Map;
    expect(body['order_number'], 'SO-000200');
    expect(body['client_generated_id'], 'order-abc');
    expect(body['source'], 'rep_app');
    final sent =
        (jsonDecode(server.to('order_lines').single.body) as List).single
            as Map;
    expect(sent['order_id'], 'order-new');
  });

  test('a refused line on a new order still spends an attempt', () async {
    // The policy said no to an order that is `new` and the rep's own. That is
    // not a state this code can reason its way out of, and hiding it would
    // recreate the silent empty order this file exists to prevent.
    final server = FakePostgrest(
      existingOrder: {'id': 'order-1', 'status': 'new'},
      linesResponse: refused('order_lines'),
    );
    final id = await queueOrder();

    await engineOver(server).sync();

    final left = await pending();
    expect(left.single.id, id);
    expect(left.single.attempts, 1);
  });

  test('nothing is replayed, or charged, with nobody signed in', () async {
    // A rep who signed out with work queued lost it: every replay was refused
    // by RLS and spent an attempt until the entry was given up.
    final server = FakePostgrest(existingOrder: null);
    await queueOrder();

    await engineOver(server, signedIn: null).sync();

    final left = await pending();
    expect(left, hasLength(1));
    expect(left.single.attempts, 0);
    expect(server.requests, isEmpty);
  });

  test("a colleague's queued work waits for them", () async {
    final server = FakePostgrest(existingOrder: null);
    await queueOrder();

    await engineOver(server, signedIn: 'rep-2').sync();

    final left = await pending();
    expect(left, hasLength(1));
    expect(left.single.attempts, 0);
    expect(server.requests, isEmpty);
  });
}
