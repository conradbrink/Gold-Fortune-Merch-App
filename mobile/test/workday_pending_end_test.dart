// A day ended out of signal stays ended. The server row is still open until
// the end drains, and `fetchActiveSession` used to trust it: the next launch
// showed the day in progress and restarted GPS tracking after clock-out.
//
// A real `SupabaseClient` over a fake PostgREST that still reports the day
// open, as the server does before the end arrives.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/repositories/workday_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  late AppDatabase db;
  late SupabaseClient client;

  final openRow = {
    'id': 'session-1',
    'client_generated_id': 'day-1',
    'org_id': 'org-1',
    'rep_id': 'rep-1',
    'started_at': '2026-10-09T06:00:00Z',
    'ended_at': null,
    'distance_meters': 1200,
    'duration_seconds': null,
  };

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient(
        (request) async => http.Response(
          jsonEncode(openRow),
          200,
          headers: {'content-type': 'application/json'},
          request: request,
        ),
      ),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
  });

  tearDown(() async {
    await client.dispose();
    await db.close();
  });

  WorkdayRepository repo() => WorkdayRepository(
    client,
    db,
    SyncEngine(
      db,
      client,
      readBuild: () async => null,
      signedInUser: () => null,
    ),
  );

  test('an open server row with no queued end is the open day', () async {
    final session = await repo().fetchActiveSession('rep-1');
    expect(session?.clientGeneratedId, 'day-1');
  });

  test('an open server row whose end is queued here is over', () async {
    await db.enqueue(
      entityType: OutboxType.workdayEnd,
      clientGeneratedId: 'day-1',
      payload: jsonEncode({
        'client_generated_id': 'day-1',
        'rep_id': 'rep-1',
        'changes': {},
      }),
    );
    expect(await repo().fetchActiveSession('rep-1'), isNull);
  });
}
