// Two ways the app could lose work a rep had already done, both on the path a
// real handset takes when the signal comes and goes.
//
// 1. A refresh rewrote the day's cache from server rows alone. While a check-in
//    was still queued the server had no visit on that route, so the stop
//    reverted to "not started" and a second tap minted a second client id — a
//    duplicate visit, which is the failure VisitRepository.checkIn writes into
//    the cache to prevent.
//
// 2. The drain skipped an entry that had exhausted its attempts and carried on
//    to the next, so a check-out could replay without its check-in. That update
//    matches no row, PostgREST calls it success, and the entry was deleted with
//    the check-out inside it.

import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/route_visit.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';

RouteVisit serverStop(String routeId, {String storeName = 'Choppies Kgale'}) {
  return RouteVisit(
    routeId: routeId,
    storeId: 'store-1',
    storeName: storeName,
    geofenceRadiusM: 100,
    sequenceOrder: 1,
    status: 'not_started',
  );
}

OutboxEntry entry(
  String type,
  String clientId, {
  int attempts = 0,
  int id = 0,
  int createdSecond = 0,
}) {
  return OutboxEntry(
    id: id,
    entityType: type,
    payload: '{}',
    clientGeneratedId: clientId,
    createdAt: DateTime.utc(2026, 7, 29, 8, 0, createdSecond),
    attempts: attempts,
  );
}

void main() {
  group('mergeUnsyncedLocalState', () {
    final checkedInLocally = serverStop('route-1').copyWith(
      status: 'checked_in',
      visitClientGeneratedId: 'visit-abc',
      checkinAt: DateTime.utc(2026, 7, 29, 9, 15),
    );

    test('keeps a check-in the server has not been told about yet', () {
      final merged = mergeUnsyncedLocalState(
        fromServer: [serverStop('route-1')],
        cached: {'route-1': checkedInLocally},
        pendingClientIds: {'visit-abc'},
      );

      expect(merged.single.status, 'checked_in');
      expect(merged.single.visitClientGeneratedId, 'visit-abc');
      expect(merged.single.checkinAt, DateTime.utc(2026, 7, 29, 9, 15));
    });

    test('takes the server version once the entry has drained', () {
      final merged = mergeUnsyncedLocalState(
        fromServer: [serverStop('route-1')],
        cached: {'route-1': checkedInLocally},
        pendingClientIds: const {},
      );

      expect(merged.single.status, 'not_started');
    });

    test('a queued check-in elsewhere does not freeze an unrelated stop', () {
      final merged = mergeUnsyncedLocalState(
        fromServer: [serverStop('route-1')],
        cached: {'route-1': checkedInLocally},
        pendingClientIds: {'visit-somebody-else'},
      );

      expect(merged.single.status, 'not_started');
    });

    test('the route and the store stay the server\'s to change', () {
      final renamed = serverStop('route-1', storeName: 'Choppies Kgale View');

      final merged = mergeUnsyncedLocalState(
        fromServer: [renamed],
        cached: {'route-1': checkedInLocally},
        pendingClientIds: {'visit-abc'},
      );

      // Local visit state survives, but the stop is still described by the
      // server — otherwise the cache would pin a stale name forever.
      expect(merged.single.storeName, 'Choppies Kgale View');
      expect(merged.single.status, 'checked_in');
    });

    test('a stop with nothing cached is passed straight through', () {
      final merged = mergeUnsyncedLocalState(
        fromServer: [serverStop('route-2')],
        cached: {'route-1': checkedInLocally},
        pendingClientIds: {'visit-abc'},
      );

      expect(merged.single.status, 'not_started');
    });
  });

  group('replayableEntries', () {
    test('holds back the check-out when its check-in has given up', () {
      final replayable = replayableEntries([
        entry(OutboxType.visitCheckIn, 'visit-abc',
            attempts: kMaxAttempts, id: 1),
        entry(OutboxType.visitCheckOut, 'visit-abc', id: 2, createdSecond: 1),
      ]);

      expect(replayable, isEmpty);
    });

    test('a poisoned entry still does not block unrelated work', () {
      final replayable = replayableEntries([
        entry(OutboxType.visitCheckIn, 'visit-abc',
            attempts: kMaxAttempts, id: 1),
        entry(OutboxType.visitCheckOut, 'visit-abc', id: 2, createdSecond: 1),
        entry(OutboxType.promotionCheck, 'promo-xyz', id: 3, createdSecond: 2),
      ]);

      expect(replayable.map((e) => e.clientGeneratedId), ['promo-xyz']);
    });

    test('the workday end waits on its own session, not on a visit', () {
      final replayable = replayableEntries([
        entry(OutboxType.workdayStart, 'day-1', attempts: kMaxAttempts, id: 1),
        entry(OutboxType.workdayEnd, 'day-1', id: 2, createdSecond: 1),
        entry(OutboxType.visitCheckIn, 'visit-abc', id: 3, createdSecond: 2),
      ]);

      expect(replayable.map((e) => e.clientGeneratedId), ['visit-abc']);
    });

    test('an entry short of the cap is still retried', () {
      final replayable = replayableEntries([
        entry(OutboxType.visitCheckIn, 'visit-abc',
            attempts: kMaxAttempts - 1, id: 1),
        entry(OutboxType.visitCheckOut, 'visit-abc', id: 2, createdSecond: 1),
      ]);

      expect(replayable.length, 2);
    });
  });
}
