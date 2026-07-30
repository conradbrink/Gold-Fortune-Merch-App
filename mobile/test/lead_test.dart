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
    test('reports the local day, not the UTC one', () {
      // Botswana is UTC+2, so anything before 02:00 local is the previous day
      // in UTC. A follow-up set late in the evening must not slide backwards.
      final lateEvening = DateTime(2026, 7, 30, 23, 30);
      expect(localDate(lateEvening), '2026-07-30');

      final earlyMorning = DateTime(2026, 7, 30, 0, 30);
      expect(localDate(earlyMorning), '2026-07-30');
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
