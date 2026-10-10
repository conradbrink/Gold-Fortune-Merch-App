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

/// 19:30 local: the rule this app has always used, and the fallback when the
/// company's own rule cannot be read (see `CompanyConfig.fallback`). The live
/// rule is the company's `auto_end_enabled` / `auto_end_time`, which the
/// server's `auto_end_overdue_workdays` also reads.
const kWorkdayAutoEndHour = 19;
const kWorkdayAutoEndMinute = 30;

/// A company's auto-end rule: off, or a local time of day.
class AutoEndRule {
  const AutoEndRule({
    required this.enabled,
    required this.hour,
    required this.minute,
  });

  final bool enabled;
  final int hour;
  final int minute;

  static const fallback = AutoEndRule(
    enabled: true,
    hour: kWorkdayAutoEndHour,
    minute: kWorkdayAutoEndMinute,
  );

  /// `"19:30"` as `(19, 30)`, or null if it is not a time.
  static (int, int)? parseTime(Object? value) {
    if (value is! String) return null;
    final m = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$').firstMatch(value);
    if (m == null) return null;
    return (int.parse(m.group(1)!), int.parse(m.group(2)!));
  }

  /// `19:30`, for the banner.
  String get label =>
      '${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}';

  @override
  bool operator ==(Object other) =>
      other is AutoEndRule &&
      other.enabled == enabled &&
      other.hour == hour &&
      other.minute == minute;

  @override
  int get hashCode => Object.hash(enabled, hour, minute);
}

/// The moment a day that started at [startedAt] ends by itself, in the
/// phone's local time.
///
/// The first cut-off after the start: a day that began yesterday morning is
/// over at yesterday's cut-off, not tonight's, and a cold start the next
/// morning must close it as of then. A day started at or after the cut-off
/// (a 20:10 call-out with a 19:30 rule) runs to the next day's cut-off; on
/// the start date it would end before it began. The server's
/// `auto_end_overdue_workdays` uses the same rule.
DateTime autoEndCutoffFor(
  DateTime startedAt, {
  AutoEndRule rule = AutoEndRule.fallback,
}) {
  final local = startedAt.toLocal();
  final sameDay =
      DateTime(local.year, local.month, local.day, rule.hour, rule.minute);
  if (local.isBefore(sameDay)) return sameDay;
  return DateTime(
      local.year, local.month, local.day + 1, rule.hour, rule.minute);
}

/// Whether a day that started at [startedAt] should already have ended.
/// Never, when the company has switched auto-end off.
bool isPastAutoEnd({
  required DateTime now,
  required DateTime startedAt,
  AutoEndRule rule = AutoEndRule.fallback,
}) =>
    rule.enabled && !now.isBefore(autoEndCutoffFor(startedAt, rule: rule));

/// How long until the day ends by itself; zero when it already should have.
/// Callers check [AutoEndRule.enabled] first: with auto-end off there is no
/// such moment to wait for.
Duration untilAutoEnd({
  required DateTime now,
  required DateTime startedAt,
  AutoEndRule rule = AutoEndRule.fallback,
}) {
  final wait = autoEndCutoffFor(startedAt, rule: rule).difference(now);
  return wait.isNegative ? Duration.zero : wait;
}
