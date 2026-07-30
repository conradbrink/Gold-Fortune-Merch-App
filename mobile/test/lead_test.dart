// A sales call is recorded in two halves, offline, and the two halves have to
// agree with what the server will accept when they finally arrive. Both rules
// below are enforced by the database, so getting them wrong on the phone means
// a call that syncs cleanly for days and then starts failing.

import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/data/models/lead.dart';
import 'package:gf_merch_rep/data/repositories/lead_repository.dart';

Lead call() => Lead(
      clientGeneratedId: 'lead-1',
      orgId: 'org-1',
      repId: 'rep-1',
      companyName: 'Kgale Superette',
      purpose: 'Ask for a listing',
      startedAt: DateTime(2026, 7, 30, 9, 15),
      startLat: -24.65,
      startLng: 25.91,
    );

void main() {
  group('Lead.copyWith', () {
    test('unticking follow-up drops the date with it', () {
      // `leads_follow_up_date_needs_flag` refuses a date without the flag, so
      // sending one would fail the whole sync entry rather than this field.
      final withDate = call().copyWith(
        followUpRequired: true,
        followUpOn: '2026-08-06',
      );
      expect(withDate.followUpOn, '2026-08-06');

      final cleared = withDate.copyWith(followUpRequired: false);
      expect(cleared.followUpRequired, isFalse);
      expect(cleared.followUpOn, isNull);
    });

    test('keeps the date while follow-up stays on', () {
      final lead = call().copyWith(
        followUpRequired: true,
        followUpOn: '2026-08-06',
      );
      final edited = lead.copyWith(outcome: 'Buyer wants a price list');
      expect(edited.followUpOn, '2026-08-06');
      expect(edited.followUpRequired, isTrue);
    });

    test('completing does not disturb what was recorded on the way in', () {
      final done = call().copyWith(
        outcome: 'Interested',
        status: 'completed',
        completedAt: DateTime(2026, 7, 30, 9, 40),
      );
      // The server freezes these; the phone must not send different values.
      expect(done.startedAt, DateTime(2026, 7, 30, 9, 15));
      expect(done.startLat, -24.65);
      expect(done.startLng, 25.91);
      expect(done.isComplete, isTrue);
    });
  });

  group('localDate', () {
    test('reads the day off the value it was given', () {
      // Botswana is UTC+2, so anything before 02:00 local is the previous day
      // in UTC. A follow-up set late in the evening must not slide backwards.
      expect(localDate(DateTime(2026, 7, 30, 23, 30)), '2026-07-30');
      expect(localDate(DateTime(2026, 7, 30, 0, 30)), '2026-07-30');
    });

    // The test above was the only guard against the bug this function exists to
    // prevent, and it only catches it in some timezones: on CAT+0200 a
    // `toUtc()`-first implementation fails it, but under `TZ=UTC` — which is what
    // CI runs — every assertion still passes, because in UTC no instant has a
    // different local and UTC day. Both were verified by sabotaging the
    // implementation and running it in each zone.
    //
    // So the divergence is asserted explicitly, on an instant chosen to straddle
    // midnight whichever side of UTC the machine sits, and skipped rather than
    // silently vacuous when there is no offset to straddle.
    test('does not convert to UTC first', () {
      final offset = DateTime.now().timeZoneOffset;
      if (offset == Duration.zero) {
        markTestSkipped(
          'needs a non-UTC zone: in UTC the local and UTC day always agree',
        );
        return;
      }

      // Ahead of UTC, early morning is still yesterday there; behind it, late
      // evening is already tomorrow.
      final straddling = offset.isNegative
          ? DateTime(2026, 7, 30, 23, 30)
          : DateTime(2026, 7, 30, 0, 30);

      // Proves the fixture really does straddle, so the assertion below means
      // something rather than passing by coincidence.
      expect(straddling.toUtc().day, isNot(30));
      expect(localDate(straddling), '2026-07-30');
    });

    test('pads months and days', () {
      expect(localDate(DateTime(2026, 1, 5)), '2026-01-05');
    });
  });

  group('round trip', () {
    test('survives the cache, which is where it lives until it syncs', () {
      final original = call().copyWith(
        outcome: 'Buyer wants a price list',
        notes: 'Call Thursday',
        followUpRequired: true,
        followUpOn: '2026-08-06',
        completedAt: DateTime(2026, 7, 30, 9, 40),
        endLat: -24.66,
        endLng: 25.92,
        status: 'completed',
      );

      final restored = Lead.fromMap(original.toMap());

      expect(restored.clientGeneratedId, original.clientGeneratedId);
      expect(restored.companyName, original.companyName);
      expect(restored.purpose, original.purpose);
      expect(restored.outcome, original.outcome);
      expect(restored.notes, original.notes);
      expect(restored.followUpRequired, isTrue);
      expect(restored.followUpOn, '2026-08-06');
      expect(restored.startedAt, original.startedAt);
      expect(restored.startLat, original.startLat);
      expect(restored.status, 'completed');
    });

    test('an open call restores with nothing invented', () {
      final restored = Lead.fromMap(call().toMap());
      expect(restored.status, 'in_progress');
      expect(restored.isComplete, isFalse);
      expect(restored.outcome, isNull);
      expect(restored.followUpRequired, isFalse);
      expect(restored.followUpOn, isNull);
      expect(restored.completedAt, isNull);
    });
  });
}
