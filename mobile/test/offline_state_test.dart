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

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/route_visit.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:gf_merch_rep/features/visit/store_detail_screen.dart';

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
  detailScreenTests();
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

    // A drain now asks the database to leave capped entries out of the window,
    // because enough of them collecting at the head of the queue would fill it
    // and stop anything newer from ever being looked at. The consequence is that
    // the check-in below is *not* in the list any more, so the only thing that
    // can hold its check-out back is the caller saying so.
    test('holds back an entry whose stalled parent is outside the window', () {
      final replayable = replayableEntries(
        [entry(OutboxType.visitCheckOut, 'visit-abc', id: 2, createdSecond: 1)],
        alreadyStalled: {'visit-abc'},
      );

      expect(replayable, isEmpty);
    });

    test('unrelated work drains while another id is stalled out of view', () {
      final replayable = replayableEntries(
        [entry(OutboxType.promotionCheck, 'promo-xyz', id: 3)],
        alreadyStalled: {'visit-abc'},
      );

      expect(replayable.map((e) => e.clientGeneratedId), ['promo-xyz']);
    });

    // The hold-back runs forwards through the queue, so reaching the cap holds
    // back what was queued *after* that entry — never what already went before
    // it. A check-in that is still fine must not be stranded by its own
    // check-out having given up.
    test('a later stalled entry does not strand the earlier one', () {
      final replayable = replayableEntries([
        entry(OutboxType.visitCheckIn, 'visit-abc', id: 1),
        entry(OutboxType.visitCheckOut, 'visit-abc',
            attempts: kMaxAttempts, id: 2, createdSecond: 1),
      ]);

      expect(replayable.map((e) => e.entityType), [OutboxType.visitCheckIn]);
    });
  });
}

// The store detail screen renders from whichever is further along: what the
// rep just did, or what the refetched day reports. Getting this backwards is
// what left a live "Check in" button sitting over a visit that already
// existed — observed persisting for nineteen minutes on a loaded device, and
// a second tap there mints a duplicate visit.

RouteVisit stop({required String status, String? clientId}) => RouteVisit(
      routeId: 'route-1',
      storeId: 'store-1',
      storeName: 'Caltex Kaunda',
      geofenceRadiusM: 100,
      sequenceOrder: 1,
      status: status,
      visitClientGeneratedId: clientId,
    );

void detailScreenTests() {
  group('furtherAlong', () {
    test('a local check-in beats a day that still says not started', () {
      final chosen = furtherAlong(
        stop(status: 'checked_in', clientId: 'visit-1'),
        stop(status: 'not_started'),
      );
      expect(chosen!.status, 'checked_in');
      expect(chosen.visitClientGeneratedId, 'visit-1');
    });

    test('the day wins once it has caught up and moved on', () {
      // The rep checked in here; the day now reports the check-out that
      // happened after. Holding the local copy would strand the screen.
      final chosen = furtherAlong(
        stop(status: 'checked_in', clientId: 'visit-1'),
        stop(status: 'checked_out', clientId: 'visit-1'),
      );
      expect(chosen!.status, 'checked_out');
    });

    test('never goes backwards from checked out', () {
      final chosen = furtherAlong(
        stop(status: 'checked_out', clientId: 'visit-1'),
        stop(status: 'not_started'),
      );
      expect(chosen!.status, 'checked_out');
    });

    test('with nothing applied yet the day is used as is', () {
      expect(furtherAlong(null, stop(status: 'not_started'))!.status,
          'not_started');
    });

    test('a stop missing from the day still renders what was applied', () {
      expect(furtherAlong(stop(status: 'checked_in'), null)!.status,
          'checked_in');
    });
  });

  // What to do when a check-out replay updates no row. Three causes, and
  // getting them wrong costs either a wedged queue or a rep's lost work.
  // A drain that meets bad signal must wait, not spend the entry's attempts.
  // FLUTTER-D: a TLS handshake cut by the network is not a SocketException,
  // and eight of them in a row had a location ping reported as given up.
  group('isTransientNetworkFailure', () {
    test('the three shapes a dropped link takes are transient', () {
      expect(
          isTransientNetworkFailure(const SocketException('unreachable')),
          isTrue);
      expect(
          isTransientNetworkFailure(
              const HandshakeException('Connection terminated during handshake')),
          isTrue);
      expect(
          isTransientNetworkFailure(
              const HttpException('Connection closed before full header')),
          isTrue);
    });

    test('a missing file is the entry\'s fault and still counts', () {
      expect(
          isTransientNetworkFailure(
              const FileSystemException('Cannot open file', '/gone.jpg')),
          isFalse);
      expect(isTransientNetworkFailure(StateError('not synced yet')), isFalse);
    });

    // The two subclasses that look like their transient parents and are not:
    // a certificate the phone rejects is rejected again next time, and a
    // redirect loop is the server's doing. Waiting on either parks the drain
    // in "offline" with the queue untouched.
    test('a bad certificate and a redirect loop are not transient', () {
      expect(
          isTransientNetworkFailure(
              const CertificateException('self-signed', null)),
          isFalse);
      expect(
          isTransientNetworkFailure(
              RedirectException('Redirect loop detected', const [])),
          isFalse);
    });
  });

  group('checkOutAlreadyRecorded', () {
    test('no visit at all is the check-in not having landed', () {
      // Retryable, and must stay so: this entry is the only record the rep
      // finished the call.
      expect(checkOutAlreadyRecorded(null), isFalse);
    });

    test('a visit still open means the update was refused, not applied', () {
      // The row reads back fine and the check-out is not on it — a policy
      // narrower on update than on select does this, and PostgREST reports it
      // as an empty result rather than an error. Retry; never delete.
      expect(
        checkOutAlreadyRecorded({'id': 'visit-1', 'checkout_at': null}),
        isFalse,
      );
    });

    test('a visit already checked out means the entry is satisfied', () {
      // The recorded time is the one that stands, so a second check-out is
      // redundant rather than pending. Dropping it is what stops the queue
      // wedging behind a write the guard will refuse forever.
      expect(
        checkOutAlreadyRecorded({
          'id': 'visit-1',
          'checkout_at': '2026-08-11T12:10:07.839Z',
        }),
        isTrue,
      );
    });
  });
}
