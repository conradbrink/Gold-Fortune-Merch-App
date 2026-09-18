// A workday ends itself at 19:30 on the day it started. Getting the *date*
// wrong is the failure that matters: a day begun yesterday must close as of
// yesterday's cut-off, or a phone woken the next morning would end it tonight
// and lock the rep out of today.

import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/features/workday/workday_auto_end.dart';

void main() {
  final start = DateTime(2026, 9, 17, 7, 47);

  test('the cut-off is 19:30 on the day the session started', () {
    expect(autoEndCutoffFor(start), DateTime(2026, 9, 17, 19, 30));
  });

  test('a day still open at 19:29 is not yet due', () {
    expect(
      isPastAutoEnd(now: DateTime(2026, 9, 17, 19, 29, 59), startedAt: start),
      isFalse,
    );
  });

  test('at 19:30 exactly it is due', () {
    expect(
      isPastAutoEnd(now: DateTime(2026, 9, 17, 19, 30), startedAt: start),
      isTrue,
    );
  });

  test(
    'a day that began yesterday is over as of yesterday, whatever the hour',
    () {
      // A day left open overnight, seen by the phone at 08:00 the next morning.
      expect(
        isPastAutoEnd(now: DateTime(2026, 9, 18, 8, 0), startedAt: start),
        isTrue,
      );
      expect(autoEndCutoffFor(start), DateTime(2026, 9, 17, 19, 30));
    },
  );

  test('the wait is measured to the cut-off and never negative', () {
    expect(
      untilAutoEnd(now: DateTime(2026, 9, 17, 17, 30), startedAt: start),
      const Duration(hours: 2),
    );
    expect(
      untilAutoEnd(now: DateTime(2026, 9, 18, 8, 0), startedAt: start),
      Duration.zero,
    );
  });

  test('a UTC start is placed on its local date first', () {
    final offset = DateTime.now().timeZoneOffset;
    if (offset != const Duration(hours: 2)) {
      markTestSkipped('written against CAT+0200 (Botswana)');
      return;
    }
    // 23:00Z on the 16th is 01:00 on the 17th in Botswana: the day started on
    // the 17th, and ends at 19:30 on the 17th.
    expect(
      autoEndCutoffFor(DateTime.utc(2026, 9, 16, 23, 0)),
      DateTime(2026, 9, 17, 19, 30),
    );
  });
}
