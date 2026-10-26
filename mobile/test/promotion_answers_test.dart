// A promotion answer given on this visit must still count once it has synced.
//
// It did not, on 1.2.4. Every row read back from the server was marked as an
// earlier visit's, so with signal a "Running" tap synced in about a second, the
// line went back to "Last time: running", and check-out warned "N promoted
// lines have not been answered" to every rep who had answered them all.
//
// A real `SupabaseClient` over a fake PostgREST, so what is asserted is the
// request the phone sends and what it makes of the reply.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/repositories/promotion_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

Map<String, dynamic> check(String productId, {String? visit}) => {
  'promotion_id': 'promo-1',
  'product_id': productId,
  'status': 'running',
  'checked_at': '2026-10-26T08:00:00Z',
  'visits': visit == null ? null : {'client_generated_id': visit},
};

void main() {
  late AppDatabase db;
  late SupabaseClient client;
  final requests = <http.Request>[];

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    requests.clear();
  });

  tearDown(() async {
    await client.dispose();
    await db.close();
  });

  /// [onRequest] runs while the request is out, before the reply is built —
  /// where a sync landing at the same moment would.
  PromotionRepository repoOver(
    List<Map<String, dynamic>> rows, {
    Future<void> Function()? onRequest,
  }) {
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        requests.add(request);
        await onRequest?.call();
        // The request rides along: postgrest reads `response.request!`.
        return http.Response(
          jsonEncode(rows),
          200,
          headers: {'content-type': 'application/json'},
          request: request,
        );
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return PromotionRepository(
      client,
      db,
      SyncEngine(
        db,
        client,
        readBuild: () async => null,
        signedInUser: () => null,
      ),
    );
  }

  Future<int> queueAnswer(String productId, {required String visit}) =>
      db.enqueue(
        entityType: OutboxType.promotionCheck,
        clientGeneratedId: 'check-$productId',
        payload: jsonEncode({
          'promotion_id': 'promo-1',
          'product_id': productId,
          'store_id': 'store-1',
          'status': 'running',
          'visit_client_generated_id': visit,
        }),
      );

  test('asks the server which visit each answer was given on', () async {
    await repoOver([]).answersForStore(
      storeId: 'store-1',
      visitClientGeneratedId: 'visit-now',
    );

    expect(
      requests.single.url.queryParameters['select'],
      contains('visits(client_generated_id)'),
    );
  });

  test('a synced answer from this visit counts as this visit', () async {
    final answers = await repoOver([
      check('prod-1', visit: 'visit-now'),
    ]).answersForStore(storeId: 'store-1', visitClientGeneratedId: 'visit-now');

    expect(answers[PromotionAnswer.key('promo-1', 'prod-1')]?.thisVisit, isTrue);
  });

  test('a synced answer from an earlier visit is still last time', () async {
    final answers = await repoOver([
      check('prod-1', visit: 'visit-before'),
      // Synced before its visit, or another rep's visit this one cannot read.
      check('prod-2'),
    ]).answersForStore(storeId: 'store-1', visitClientGeneratedId: 'visit-now');

    expect(answers[PromotionAnswer.key('promo-1', 'prod-1')]?.thisVisit, isFalse);
    expect(answers[PromotionAnswer.key('promo-1', 'prod-2')]?.thisVisit, isFalse);
  });

  test('an answer that syncs while the server is being asked is kept', () async {
    // The tap's entry drains while the request is out, and the server read
    // was taken before the insert landed: it is in neither the reply nor,
    // afterwards, the outbox.
    final id = await queueAnswer('prod-1', visit: 'visit-now');
    final answers = await repoOver(
      [],
      onRequest: () => db.deleteEntry(id),
    ).answersForStore(storeId: 'store-1', visitClientGeneratedId: 'visit-now');

    expect(answers[PromotionAnswer.key('promo-1', 'prod-1')]?.thisVisit, isTrue);
  });

  test('a re-tap still supersedes the tap before it', () async {
    await queueAnswer('prod-1', visit: 'visit-now');
    await db.enqueue(
      entityType: OutboxType.promotionCheck,
      clientGeneratedId: 'check-prod-1-again',
      payload: jsonEncode({
        'promotion_id': 'promo-1',
        'product_id': 'prod-1',
        'store_id': 'store-1',
        'status': 'not_running',
        'visit_client_generated_id': 'visit-now',
      }),
    );

    final answers = await repoOver([]).answersForStore(
      storeId: 'store-1',
      visitClientGeneratedId: 'visit-now',
    );

    expect(answers[PromotionAnswer.key('promo-1', 'prod-1')]?.status, 'not_running');
  });
}
