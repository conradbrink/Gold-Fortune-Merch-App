// Damaged stock is filed against its visit (the photo goes into `photos`,
// which needs the visit's server id), so the report waits for its check-in
// and then lands once. A real `SupabaseClient` over a fake PostgREST, as in
// order_replay_test.dart.

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

  SyncEngine engine({required bool visitLanded}) {
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        requests.add(request);
        final path = request.url.path;
        if (path.endsWith('/visits')) {
          return _answer(request, visitLanded ? [{'id': 'visit-9'}] : [], 200);
        }
        if (path.endsWith('/damage_reports')) return _answer(request, [], 201);
        if (path.contains('/storage/v1/object/damage-photos/')) {
          return _answer(request, {'Key': 'damage-photos/x'}, 200);
        }
        return http.Response('unexpected $path', 500, request: request);
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return SyncEngine(db, client, readBuild: () async => null, signedInUser: () => 'rep-1');
  }

  Future<void> queue({String? photoPath}) => db.enqueue(
        entityType: OutboxType.damageReport,
        clientGeneratedId: 'damage-1',
        payload: jsonEncode({
          'local_photo_path': ?photoPath,
          'org_id': 'org-1',
          'rep_id': 'rep-1',
          'store_id': 'store-1',
          'visit_client_generated_id': 'visit-client-1',
          'client_generated_id': 'damage-1',
          'product_id': 'prod-1',
          'item': null,
          'qty': 3,
          'problem': 'Broken',
          'created_at': '2026-10-15T10:00:00.000Z',
        }),
      );

  Future<List<OutboxEntry>> pending() => db.pendingEntries(maxAttempts: kMaxAttempts);

  test('waits for its check-in, as a form does', () async {
    await queue();
    final entry = (await pending()).single;
    expect(dependencyKeyOf(entry), outboxEntryKey(OutboxType.visitCheckIn, 'visit-client-1'));

    await engine(visitLanded: false).sync();
    expect(await pending(), hasLength(1));
    expect(requests.where((r) => r.url.path.endsWith('/damage_reports')), isEmpty);
  });

  test('lands once against the visit, and a retry meets its own row quietly', () async {
    await queue();
    await engine(visitLanded: true).sync();

    expect(await pending(), isEmpty);
    final post = requests.singleWhere((r) => r.url.path.endsWith('/damage_reports'));
    expect(post.url.queryParameters['on_conflict'], 'client_generated_id');
    expect(post.headers['Prefer'], contains('resolution=ignore-duplicates'));
    final body = jsonDecode(post.body);
    final row = body is List ? body.single : body;
    expect(row['visit_id'], 'visit-9');
    expect(row['qty'], 3);
    expect(row['photo_path'], isNull);
    expect(row.containsKey('local_photo_path'), isFalse);
  });

  test("the photo goes to damage-photos in the rep's folder, never into photos, and leaves the phone", () async {
    final dir = await Directory.systemTemp.createTemp('damage');
    final photo = File('${dir.path}/p.jpg')..writeAsBytesSync([0xff, 0xd8, 0xff]);
    await queue(photoPath: photo.path);
    await engine(visitLanded: true).sync();

    expect(await pending(), isEmpty);
    final upload = requests.singleWhere((r) => r.url.path.contains('/storage/v1/object/'));
    expect(upload.url.path, endsWith('/damage-photos/org-1/rep-1/damage-1.jpg'));
    expect(requests.where((r) => r.url.path.endsWith('/photos')), isEmpty);
    final post = requests.singleWhere((r) => r.url.path.endsWith('/damage_reports'));
    final body = jsonDecode(post.body);
    final row = body is List ? body.single : body;
    expect(row['photo_path'], 'org-1/rep-1/damage-1.jpg');
    expect(photo.existsSync(), isFalse, reason: 'landed, so the copy on the phone goes');
    await dir.delete(recursive: true);
  });

  test('a photo the OS took back is a report without one', () async {
    await queue(photoPath: '/no/such/file.jpg');
    await engine(visitLanded: true).sync();
    expect(await pending(), isEmpty);
    expect(requests.where((r) => r.url.path.contains('/storage/')), isEmpty);
  });
}
