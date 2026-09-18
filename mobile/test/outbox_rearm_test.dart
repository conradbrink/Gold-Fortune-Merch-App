// An entry that has used up its attempts is never retried — right, until a new
// build fixes the reason it failed, and then it is the one thing on the phone
// that will never find out. A rep's workday start that stalled on 1.1.8 held
// back every ping of every day after it, and 1.1.9 would have changed nothing.

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  late AppDatabase db;
  late SupabaseClient client;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    // Never contacted; the engine is only asked about its queue here.
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
  });

  tearDown(() async {
    await client.dispose();
    await db.close();
  });

  Future<void> stall(int id) => db.recordFailure(id, kMaxAttempts, 'refused');

  test('a new build re-arms every stalled entry, once', () async {
    final start = await db.enqueue(
      entityType: OutboxType.workdayStart,
      payload: '{}',
      clientGeneratedId: 'day-1',
    );
    final ping = await db.enqueue(
      entityType: OutboxType.locationPing,
      payload: '{}',
      clientGeneratedId: 'ping-1',
    );
    await db.enqueue(
      entityType: OutboxType.visitCheckIn,
      payload: '{}',
      clientGeneratedId: 'visit-1',
    );
    await stall(start);
    await stall(ping);
    expect(await db.pendingEntries(maxAttempts: kMaxAttempts), hasLength(1));

    final engine = SyncEngine(db, client, readBuild: () async => '9');
    expect(await engine.rearmForNewBuild(), 2);
    expect(await db.pendingEntries(maxAttempts: kMaxAttempts), hasLength(3));
    expect(await db.stalledClientIds(kMaxAttempts), isEmpty);

    // The same build asking again is not an upgrade.
    await stall(start);
    expect(await engine.rearmForNewBuild(), 0);
    expect(await db.stalledClientIds(kMaxAttempts), {'day-1'});

    // The next build is.
    final next = SyncEngine(db, client, readBuild: () async => '10');
    expect(await next.rearmForNewBuild(), 1);
  });

  test('a build that cannot be read leaves the queue as it is', () async {
    final id = await db.enqueue(
      entityType: OutboxType.workdayStart,
      payload: '{}',
      clientGeneratedId: 'day-1',
    );
    await stall(id);

    final engine = SyncEngine(db, client, readBuild: () async => null);
    expect(await engine.rearmForNewBuild(), 0);
    expect(await db.stalledClientIds(kMaxAttempts), {'day-1'});

    // And has not spent the re-arm: a later launch that can read the build
    // still gets it.
    final later = SyncEngine(db, client, readBuild: () async => '9');
    expect(await later.rearmForNewBuild(), 1);
  });

  test('queued keys name each entry by type and id', () async {
    await db.enqueue(
      entityType: OutboxType.workdayStart,
      payload: '{}',
      clientGeneratedId: 'day-1',
    );
    await db.enqueue(
      entityType: OutboxType.workdayEnd,
      payload: '{}',
      clientGeneratedId: 'day-1',
    );
    await db.enqueue(
      entityType: OutboxType.locationPing,
      payload: '{}',
      clientGeneratedId: 'ping-1',
    );

    expect(await db.queuedEntryKeys(), {
      outboxEntryKey(OutboxType.workdayStart, 'day-1'),
      outboxEntryKey(OutboxType.workdayEnd, 'day-1'),
      outboxEntryKey(OutboxType.locationPing, 'ping-1'),
    });
  });
}
