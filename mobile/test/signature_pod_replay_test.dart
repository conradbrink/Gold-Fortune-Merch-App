// The manager's signature travels with the order, and the driver's drop with
// its POD photo (20261027201700). A real `SupabaseClient` over a fake
// PostgREST and Storage, as in order_replay_test.dart, so what is asserted is
// what the phone actually sends.

import 'dart:convert';
import 'dart:io';

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

Map<String, dynamic> _row(http.Request r) {
  final body = jsonDecode(r.body);
  return Map<String, dynamic>.from(body is List ? body.single as Map : body as Map);
}

void main() {
  late AppDatabase db;
  SupabaseClient? client;
  late List<http.Request> requests;
  late Directory dir;

  setUp(() async {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    requests = [];
    dir = await Directory.systemTemp.createTemp('sigpod');
  });

  tearDown(() async {
    await client?.dispose();
    client = null;
    await db.close();
    if (dir.existsSync()) await dir.delete(recursive: true);
  });

  SyncEngine engine(http.Response Function(http.Request) answer) {
    final c = client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        requests.add(request);
        return answer(request);
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return SyncEngine(db, c, readBuild: () async => null, signedInUser: () => 'rep-1');
  }

  Future<List<OutboxEntry>> pending() => db.pendingEntries(maxAttempts: kMaxAttempts);

  Iterable<http.Request> storage() => requests.where((r) => r.url.path.contains('/storage/v1/object/'));

  group('a signed order', () {
    http.Response server(http.Request r, {Map<String, dynamic>? existing}) {
      final path = r.url.path;
      if (path.endsWith('/orders') && r.method == 'GET') {
        return _answer(r, [?existing], 200);
      }
      if (path.endsWith('/rpc/next_document_number')) return _answer(r, 'SO-000300', 200);
      if (path.endsWith('/orders') && r.method == 'POST') return _answer(r, {'id': 'order-new'}, 201);
      if (path.endsWith('/order_lines')) return _answer(r, [], 201);
      if (path.contains('/storage/v1/object/order-signatures/')) {
        return _answer(r, {'Key': 'order-signatures/x'}, 200);
      }
      return http.Response('unexpected $path', 500, request: r);
    }

    Future<void> queue({String? signaturePath, String? name = 'Thabo Manager'}) => db.enqueue(
          entityType: OutboxType.orderCreate,
          clientGeneratedId: 'order-abc',
          payload: jsonEncode({
            'org_id': 'org-1',
            'rep_id': 'rep-1',
            'store_id': 'store-1',
            'client_generated_id': 'order-abc',
            'local_signature_path': signaturePath,
            'signed_by_name': name,
            'signed_at': '2026-10-27T10:00:00.000Z',
            'lines': [
              {'product_id': 'prod-1', 'qty_ordered': 12, 'unit_price': null, 'client_generated_id': 'line-1'},
            ],
          }),
        );

    test("the picture goes up into the rep's folder first, and the order names it", () async {
      final png = File('${dir.path}/s.png')..writeAsBytesSync([0x89, 0x50, 0x4e, 0x47]);
      await queue(signaturePath: png.path);
      await engine(server).sync();

      expect(await pending(), isEmpty);
      final upload = storage().single;
      expect(upload.url.path, endsWith('/order-signatures/org-1/rep-1/order-abc.png'));
      final header = _row(requests.singleWhere((r) => r.url.path.endsWith('/orders') && r.method == 'POST'));
      expect(header['signature_path'], 'org-1/rep-1/order-abc.png');
      expect(header['signed_by_name'], 'Thabo Manager');
      expect(header['signed_at'], '2026-10-27T10:00:00.000Z');
      expect(header.containsKey('local_signature_path'), isFalse);
      expect(requests.indexOf(upload), lessThan(requests.indexWhere((r) => r.url.path.endsWith('/orders') && r.method == 'POST')));
      expect(png.existsSync(), isFalse, reason: 'landed, so the copy on the phone goes');
    });

    test('a picture the phone lost is an order without one, all three columns left out', () async {
      await queue(signaturePath: '${dir.path}/gone.png');
      await engine(server).sync();

      expect(await pending(), isEmpty);
      expect(storage(), isEmpty);
      final header = _row(requests.singleWhere((r) => r.url.path.endsWith('/orders') && r.method == 'POST'));
      expect(header.containsKey('signature_path'), isFalse);
      expect(header.containsKey('signed_by_name'), isFalse);
      expect(header.containsKey('signed_at'), isFalse);
    });

    test('an order already there uploads nothing again', () async {
      final png = File('${dir.path}/s.png')..writeAsBytesSync([0x89, 0x50]);
      await queue(signaturePath: png.path);
      await engine((r) => server(r, existing: {'id': 'order-old', 'status': 'new'})).sync();

      expect(await pending(), isEmpty);
      expect(storage(), isEmpty);
      expect(png.existsSync(), isFalse);
    });
  });

  group("the driver's drop", () {
    Future<File> queue() async {
      final photo = File('${dir.path}/pod.jpg')..writeAsBytesSync([0xff, 0xd8, 0xff]);
      await db.enqueue(
        entityType: OutboxType.deliveryConfirm,
        clientGeneratedId: 'dispatch-1',
        payload: jsonEncode({
          'org_id': 'org-1',
          'rep_id': 'rep-1',
          'dispatch_id': 'dispatch-1',
          'order_id': 'order-1',
          'received_by_name': 'K. Molefe',
          'delivered_at': '2026-10-27T09:30:00.000Z',
          'photo_client_id': 'photo-1',
          'local_photo_path': photo.path,
        }),
      );
      return photo;
    }

    http.Response Function(http.Request) server({
      int uploadStatus = 200,
      Object? uploadBody,
      int rpcStatus = 200,
      Object? rpcBody,
    }) =>
        (r) {
          final path = r.url.path;
          if (path.contains('/storage/v1/object/fulfilment-docs/')) {
            return _answer(r, uploadBody ?? {'Key': 'fulfilment-docs/x'}, uploadStatus);
          }
          if (path.endsWith('/rpc/delivery_confirm')) {
            return _answer(r, rpcBody ?? {'status': 'delivered', 'pod_status': 'received'}, rpcStatus);
          }
          return http.Response('unexpected $path', 500, request: r);
        };

    test('the photo goes under the order, then the call, and the copy leaves the phone', () async {
      final photo = await queue();
      await engine(server()).sync();

      expect(await pending(), isEmpty);
      final upload = storage().single;
      expect(upload.url.path, endsWith('/fulfilment-docs/org-1/order-1/photo-1.jpg'));
      final call = requests.singleWhere((r) => r.url.path.endsWith('/rpc/delivery_confirm'));
      expect(jsonDecode(call.body), {
        'p_dispatch_id': 'dispatch-1',
        'p_received_by_name': 'K. Molefe',
        'p_delivered_at': '2026-10-27T09:30:00.000Z',
        'p_pod_path': 'org-1/order-1/photo-1.jpg',
        'p_size_bytes': 3,
      });
      expect(requests.indexOf(upload), lessThan(requests.indexOf(call)));
      expect(photo.existsSync(), isFalse);
    });

    test('a photo already uploaded by an earlier try is not a failure', () async {
      await queue();
      await engine(server(
        uploadStatus: 400,
        uploadBody: {'statusCode': '409', 'error': 'Duplicate', 'message': 'The resource already exists'},
      )).sync();

      expect(await pending(), isEmpty);
      expect(requests.where((r) => r.url.path.endsWith('/rpc/delivery_confirm')), hasLength(1));
    });

    test('a dispatch the warehouse returned is let go, not retried behind everything', () async {
      await queue();
      await engine(server(
        rpcStatus: 403,
        rpcBody: {
          'code': '42501',
          'message': 'Dispatch DSP-000300 was marked returned by the warehouse, so it cannot be recorded as delivered.',
          'details': null,
          'hint': null,
        },
      )).sync();

      expect(await pending(), isEmpty);
    });

    test('a refusal that may clear up is kept and retried', () async {
      await queue();
      await engine(server(
        rpcStatus: 403,
        rpcBody: {'code': '42501', 'message': 'Dispatch DSP-000300 is already delivered.', 'details': null, 'hint': null},
      )).sync();

      final left = await pending();
      expect(left, hasLength(1));
      expect(left.single.attempts, 1);
    });
  });

  group('deliveries waiting on this phone', () {
    test('one that has given up is not "waiting", so the driver can record it again', () async {
      final live = await db.enqueue(entityType: OutboxType.deliveryConfirm, clientGeneratedId: 'dispatch-1', payload: '{}');
      final stuck = await db.enqueue(entityType: OutboxType.deliveryConfirm, clientGeneratedId: 'dispatch-2', payload: '{}');
      await db.enqueue(entityType: OutboxType.orderCreate, clientGeneratedId: 'dispatch-3', payload: '{}');
      await db.recordFailure(stuck, kMaxAttempts, 'refused');
      await db.recordFailure(live, 2, 'offline');

      expect(await db.retryingClientIds(OutboxType.deliveryConfirm, kMaxAttempts), {'dispatch-1'});
    });

    test('recording it again can take the stalled try out of the queue', () async {
      final stuck = await db.enqueue(entityType: OutboxType.deliveryConfirm, clientGeneratedId: 'dispatch-2', payload: '{"local_photo_path":"/x.jpg"}');
      await db.recordFailure(stuck, kMaxAttempts, 'refused');
      await db.enqueue(entityType: OutboxType.damageReport, clientGeneratedId: 'dispatch-2', payload: '{}');

      expect(await db.entriesFor(OutboxType.deliveryConfirm, 'dispatch-2'), hasLength(1));
      expect(await db.deleteEntriesFor(OutboxType.deliveryConfirm, 'dispatch-2'), 1);
      expect(await db.entriesFor(OutboxType.deliveryConfirm, 'dispatch-2'), isEmpty);
      expect(await db.entriesFor(OutboxType.damageReport, 'dispatch-2'), hasLength(1),
          reason: 'only that kind of entry goes');
    });
  });
}
