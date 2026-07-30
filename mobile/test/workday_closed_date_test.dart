import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/repositories/lead_repository.dart'
    show localDate;

/// The date arithmetic behind "one workday per day".
///
/// `WorkdayRepository.hasClosedWorkdayToday` compares
/// `localDate(DateTime.parse(ended_at).toLocal())` against
/// `localDate(DateTime.now())`. Both sides must be in *local* time. Getting
/// this wrong does not throw and does not look broken — it silently lets a rep
/// open a second workday, or wrongly locks one out of a legitimate new day,
/// and only in a two-hour window nobody tests in.
///
/// These assert the derivation directly rather than through the repository,
/// which needs a Supabase client and a database.
void main() {
  /// What the repository does with a server `ended_at` string.
  String closedOnFrom(String endedAtIso) =>
      localDate(DateTime.parse(endedAtIso).toLocal());

  test('a day closed in the evening belongs to that evening, not tomorrow', () {
    final offset = DateTime.now().timeZoneOffset;
    if (offset != const Duration(hours: 2)) {
      markTestSkipped('written against CAT+0200 (Botswana)');
      return;
    }

    // 21:30 local on 30 July is 19:30Z the same day — the ordinary case.
    expect(closedOnFrom('2026-07-30T19:30:00Z'), '2026-07-30');
  });

  test('the local day wins where it disagrees with the UTC day', () {
    final offset = DateTime.now().timeZoneOffset;
    if (offset == Duration.zero) {
      markTestSkipped(
        'needs a non-UTC zone: in UTC the local and UTC day always agree',
      );
      return;
    }

    // Ahead of UTC, the small hours are still yesterday in UTC. A rep closing
    // at 00:30 local on 31 July did so on the 31st; recording the UTC date
    // would file it under the 30th, and they could start again that morning.
    final instant = offset.isNegative
        ? DateTime.utc(2026, 7, 31, 2, 30) // behind UTC: still the 30th locally
        : DateTime.utc(2026, 7, 30, 22, 30); // ahead: already the 31st locally

    // Proves the fixture actually straddles midnight in this zone, so the
    // assertion below is not passing by coincidence.
    expect(
      instant.day,
      isNot(instant.toLocal().day),
      reason: 'fixture must straddle midnight or it tests nothing',
    );

    expect(closedOnFrom(instant.toIso8601String()), isNot(localDate(instant)));
    expect(closedOnFrom(instant.toIso8601String()),
        localDate(instant.toLocal()));
  });

  test('a day closed yesterday does not match today', () {
    final now = DateTime.now();
    final yesterday = now.subtract(const Duration(days: 1));
    expect(localDate(yesterday), isNot(localDate(now)));
  });
}
