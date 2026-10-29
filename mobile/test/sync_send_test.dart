// Whether work saved on the phone has reached the server, asked straight
// after saving it (29 Oct 2026: a driver with full signal was told the drop
// "will reach the warehouse when you have signal").
//
// What these hold: a sync asked for while a drain is under way waits for it,
// and work queued meanwhile goes in one more drain before the caller hears
// back, in one extra pass and no more; a drain that stopped is not run
// again; and `sentWithin` says sent only when the entry has left the phone.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/order_draft.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/repositories/order_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';

/// Queues without sending: the engine under test does the sending.
class _SilentSync extends SyncEngine {
  _SilentSync(AppDatabase db)
      : super(db, SupabaseClient('http://localhost:1', 'test-anon-key'));

  @override
  Future<void> sync() async {}
}

const _line = OrderDraftLine(productId: 'p1', qty: 3, unitsPerShrink: 10);

void main() {
  late AppDatabase db;
  late OrderRepository orders;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    orders = OrderRepository(
      SupabaseClient('http://localhost:1', 'test-anon-key'),
      db,
      _SilentSync(db),
    );
  });
  tearDown(() => db.close());

  Future<String> queueOrder(String store) => orders.submitOrder(
        orgId: 'org-1',
        repId: 'rep-1',
        storeId: store,
        draftId: OrderDraft.newOrderId('rep-1', store),
        receivedVia: 'whatsapp',
        contactName: 'Mma Dintwe',
        contactPhone: '0821234567',
        deliveryAddress: '12 Main Road, Mahikeng',
        lines: const [_line],
      );

  /// An engine over a server that answers an order's calls with [onInsert]
  /// deciding each `orders` insert. Counts the inserts.
  ({SyncEngine engine, List<String> inserted}) engineWith(
    Future<http.Response> Function(http.Request r) onInsert,
  ) {
    final inserted = <String>[];
    http.Response ok(http.Request r, Object body, [int status = 200]) =>
        http.Response(jsonEncode(body), status,
            headers: const {'content-type': 'application/json'}, request: r);
    final client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((r) async {
        final path = r.url.path;
        if (path.endsWith('/orders') && r.method == 'GET') return ok(r, []);
        if (path.endsWith('/rpc/next_document_number')) return ok(r, 'SO-000201');
        if (path.endsWith('/orders') && r.method == 'POST') {
          inserted.add(jsonDecode(r.body)['store_id'] as String);
          return onInsert(r);
        }
        if (path.endsWith('/order_lines')) return ok(r, [], 201);
        return http.Response('unexpected $path', 500, request: r);
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    addTearDown(client.dispose);
    final engine = SyncEngine(
      db,
      client,
      readBuild: () async => null,
      signedInUser: () => 'rep-1',
    );
    addTearDown(engine.dispose);
    return (engine: engine, inserted: inserted);
  }

  http.Response created(http.Request r) => http.Response(
        jsonEncode({'id': 'order-${r.hashCode}'}),
        201,
        headers: const {'content-type': 'application/json'},
        request: r,
      );

  test('asked again mid-drain, it waits, and what was queued meanwhile goes too', () async {
    final hold = Completer<void>();
    final s = engineWith((r) async {
      await hold.future;
      return created(r);
    });
    final states = <SyncState>[];
    final listening = s.engine.status.listen((st) => states.add(st.state));
    addTearDown(listening.cancel);
    await queueOrder('store-a');
    final first = s.engine.sync();
    // The first drain is at the server with store-a when store-b is saved.
    while (s.inserted.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    await queueOrder('store-b');
    var answered = false;
    final second = s.engine.sync().then((_) => answered = true);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(answered, isFalse, reason: 'it waits for the drain under way');

    hold.complete();
    await Future.wait([first, second]);
    expect(s.inserted, ['store-a', 'store-b']);
    expect(await db.pendingEntries(), isEmpty, reason: 'both landed before the caller heard back');
    await Future<void>.delayed(Duration.zero);
    expect(states, [SyncState.syncing, SyncState.syncing, SyncState.idle],
        reason: 'the banner does not go back to idle between the two passes');
  });

  test('asked again during the extra pass, it stops there', () async {
    final holds = {'store-a': Completer<void>(), 'store-b': Completer<void>()};
    final s = engineWith((r) async {
      await holds[jsonDecode(r.body)['store_id']]?.future;
      return created(r);
    });
    Future<void> reached(int inserts) async {
      while (s.inserted.length < inserts) {
        await Future<void>.delayed(Duration.zero);
      }
    }

    await queueOrder('store-a');
    final first = s.engine.sync();
    await reached(1);
    await queueOrder('store-b');
    final second = s.engine.sync();
    holds['store-a']!.complete();
    // The extra pass is at the server with store-b when store-c is saved.
    await reached(2);
    await queueOrder('store-c');
    final third = s.engine.sync();
    holds['store-b']!.complete();

    await Future.wait([first, second, third]);
    expect(s.inserted, ['store-a', 'store-b'], reason: 'one extra pass, not a chain of them');
    final left = (await db.pendingEntries()).single;
    expect(jsonDecode(left.payload)['store_id'], 'store-c');
    expect(left.attempts, 0, reason: 'it waits for the next trigger, untried');
  });

  test('a drain that stopped at a refusal is not run again on the spot', () async {
    final hold = Completer<void>();
    final s = engineWith((r) async {
      await hold.future;
      return http.Response('{"message":"no"}', 400,
          headers: const {'content-type': 'application/json'}, request: r);
    });
    await queueOrder('store-a');
    final first = s.engine.sync();
    while (s.inserted.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    final second = s.engine.sync();
    hold.complete();
    await Future.wait([first, second]);
    expect(s.inserted, ['store-a'], reason: 'one attempt spent, not two');
    expect((await db.pendingEntries()).single.attempts, 1);
  });

  group('sentWithin', () {
    test('sent when the entry has left the phone', () async {
      final s = engineWith((r) async => created(r));
      final id = await queueOrder('store-a');
      expect(await s.engine.sentWithin(OutboxType.orderCreate, id), isTrue);
    });

    test('not sent with no signal, and nothing is spent', () async {
      final s = engineWith((r) async => throw const SocketException('no route to host'));
      final id = await queueOrder('store-a');
      expect(await s.engine.sentWithin(OutboxType.orderCreate, id), isFalse);
      expect((await db.pendingEntries()).single.attempts, 0);
    });

    test('not sent while it is still going, and it carries on', () async {
      final hold = Completer<void>();
      final s = engineWith((r) async {
        await hold.future;
        return created(r);
      });
      final id = await queueOrder('store-a');
      expect(
        await s.engine.sentWithin(
          OutboxType.orderCreate,
          id,
          within: const Duration(milliseconds: 50),
        ),
        isFalse,
      );
      hold.complete();
      await s.engine.sync();
      expect(await db.pendingEntries(), isEmpty);
    });
  });
}
