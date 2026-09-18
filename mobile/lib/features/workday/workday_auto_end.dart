/// When an open workday ends itself.
///
/// A rep who forgets to end their day leaves the foreground service sampling
/// GPS all night, and the day out of every total. It happened in September
/// 2026. The owner's instruction was "auto end at 7pm, or 7:30" — this is the
/// 7:30.
///
/// Two halves, and they must agree. The **server** closes any day still open
/// past this time in the organisation's timezone (`auto_end_overdue_workdays`,
/// run nightly), which is authoritative and catches a phone that died. The
/// **phone** ends its own day at the same moment, which is what actually stops
/// the location service on the handset — the server closing the row does not
/// reach into the phone. Both record the end as *this time on the day the
/// session started*, not the moment they got round to it, so a job that runs
/// late and a phone that wakes up the next morning write the same answer.
///
/// The phone uses its own local clock, the server the organisation's zone.
/// They are the same zone for every rep this app has, and the phone cannot
/// read the organisation's setting offline; if a rep ever works from another
/// zone the server's answer stands, because the replay of a phone end lands
/// after the server has already closed the day.
library;

/// 19:30 local. Change `auto_end_overdue_workdays`'s default with it.
const kWorkdayAutoEndHour = 19;
const kWorkdayAutoEndMinute = 30;

/// The moment a day that started at [startedAt] ends by itself, in the
/// phone's local time.
///
/// On the *start* date, always: a day that began yesterday is over at
/// yesterday's cut-off, not tonight's, and a cold start the next morning must
/// close it as of then.
DateTime autoEndCutoffFor(DateTime startedAt) {
  final local = startedAt.toLocal();
  return DateTime(
    local.year,
    local.month,
    local.day,
    kWorkdayAutoEndHour,
    kWorkdayAutoEndMinute,
  );
}

/// Whether a day that started at [startedAt] should already have ended.
bool isPastAutoEnd({required DateTime now, required DateTime startedAt}) =>
    !now.isBefore(autoEndCutoffFor(startedAt));

/// How long until the day ends by itself; zero when it already should have.
Duration untilAutoEnd({required DateTime now, required DateTime startedAt}) {
  final wait = autoEndCutoffFor(startedAt).difference(now);
  return wait.isNegative ? Duration.zero : wait;
}
