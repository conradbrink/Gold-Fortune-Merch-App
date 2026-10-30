import 'dart:async';
import 'dart:convert';
import 'dart:math' show max;

import 'package:geolocator/geolocator.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/location_service.dart';
import '../../core/location_tracking.dart';
import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/workday_session.dart';
import '../sync/sync_engine.dart';
// `localDate` lives with leads because that is where the timezone bug was
// first found; it is a general local-calendar-date helper, not lead-specific.
import 'lead_repository.dart' show localDate;

const _uuid = Uuid();

class WorkdayRepository {
  WorkdayRepository(this._client, this._db, this._sync);

  final SupabaseClient _client;
  final AppDatabase _db;
  final SyncEngine _sync;

  static String _activeKey(String repId) => 'active_workday:$repId';

  /// The local calendar date of the rep's last completed workday.
  ///
  /// Stored as `yyyy-mm-dd` in *local* time, never UTC. Botswana is UTC+2, so
  /// a day closed at 21:00 is already tomorrow in UTC — recording the UTC date
  /// would free the rep to start a second workday the same evening, which is
  /// the exact thing this is here to prevent.
  static String _closedKey(String repId) => 'workday_closed_on:$repId';

  /// The day [repId] last ended themselves on this phone, kept so they can
  /// take the end back (see [reopenWorkday]).
  static String _lastEndedKey(String repId) => 'workday_last_ended:$repId';

  /// The open workday, resilient to having no connection.
  ///
  /// A workday started offline exists only in the outbox until it syncs, so a
  /// server lookup alone reports "not started" after an app restart — and the
  /// rep would tap Start again and queue a duplicate session. The locally
  /// cached copy is therefore authoritative whenever the server can't be
  /// reached or hasn't received the row yet.
  Future<WorkdaySession?> fetchActiveSession(String repId) async {
    final local = await _cachedActiveSession(repId);

    try {
      final row = await _client
          .from('workday_sessions')
          .select()
          .eq('rep_id', repId)
          .isFilter('ended_at', null)
          .order('started_at', ascending: false)
          .limit(1)
          .maybeSingle();

      if (row != null) {
        final server = WorkdaySession.fromMap(row);
        // Ended on this phone with the end still queued: the server row stays
        // open until the outbox drains, but the day is over. Trusting the row
        // re-opened the day on the next launch and restarted GPS tracking
        // after clock-out, and a second End queued a second, later end.
        if (await hasPendingEnd(server.clientGeneratedId)) {
          if (local?.clientGeneratedId == server.clientGeneratedId) {
            await clearActiveSession(repId);
          }
          return null;
        }
        // Locally accrued mileage is ahead of the server until the pings
        // drain, so keep whichever is greater.
        final merged = local != null &&
                local.clientGeneratedId == server.clientGeneratedId &&
                local.distanceMeters > server.distanceMeters
            ? server.copyWith(distanceMeters: local.distanceMeters)
            : server;
        await cacheActiveSession(merged);
        return merged;
      }

      // Server has no open session. Trust the local copy only while its start
      // or its reopening is still queued — otherwise the day genuinely ended
      // elsewhere.
      if (local != null &&
          (await _hasPendingStart(local.clientGeneratedId) ||
              await _hasPendingReopen(local.clientGeneratedId))) {
        return local;
      }
      if (local != null) await clearActiveSession(repId);
      return null;
    } catch (_) {
      return local;
    }
  }

  Future<WorkdaySession?> _cachedActiveSession(String repId) async {
    final raw = await _db.getValue(_activeKey(repId));
    if (raw == null) return null;
    return WorkdaySession.fromMap(jsonDecode(raw) as Map<String, dynamic>);
  }

  /// Whether this phone has the end of [clientGeneratedId] queued, and has
  /// not taken it back since. Asked of that session's entries alone, not a
  /// window: a day's pings can outnumber any window.
  Future<bool> hasPendingEnd(String clientGeneratedId) async {
    final ends = await _db.entriesFor(OutboxType.workdayEnd, clientGeneratedId);
    if (ends.isEmpty) return false;
    final reopens =
        await _db.entriesFor(OutboxType.workdayReopen, clientGeneratedId);
    // Queued in the order the rep tapped, so the later id is the later tap.
    final lastEnd = ends.map((e) => e.id).reduce(max);
    return reopens.every((e) => e.id < lastEnd);
  }

  Future<bool> _hasPendingReopen(String clientGeneratedId) async =>
      (await _db.entriesFor(OutboxType.workdayReopen, clientGeneratedId))
          .isNotEmpty;

  Future<bool> _hasPendingStart(String clientGeneratedId) async =>
      (await _db.entriesFor(OutboxType.workdayStart, clientGeneratedId))
          .isNotEmpty;

  Future<void> cacheActiveSession(WorkdaySession session) {
    return _db.setValue(
      _activeKey(session.repId),
      jsonEncode(session.toMap()),
    );
  }

  Future<void> clearActiveSession(String repId) =>
      _db.deleteValue(_activeKey(repId));

  /// Whether this rep has already closed a workday today, and so must wait
  /// until tomorrow before starting another.
  ///
  /// Answered from the local record first and only then from the server. That
  /// order is deliberate: a rep who ends their day out of signal has a closed
  /// day that the server does not know about yet, and asking the server first
  /// would answer "no workday today" and let them start a second one. The
  /// local record is written the moment the day is closed, before the outbox
  /// has drained.
  ///
  /// A failure to reach the server is treated as "not closed" rather than
  /// "closed": being wrongly blocked from working is worse for a rep standing
  /// outside a shop than being wrongly allowed a second session, which a
  /// manager can see and correct.
  Future<bool> hasClosedWorkdayToday(String repId) async {
    final today = localDate(DateTime.now());

    if (await _db.getValue(_closedKey(repId)) == today) return true;

    try {
      // Keyed on the day the closed workday *started*: a night shift from
      // Monday 22:00 to Tuesday 06:00 is Monday's, so Tuesday's 22:00 start
      // is still allowed. Keyed on the end, it locked the rep out.
      final row = await _client
          .from('workday_sessions')
          .select('started_at')
          .eq('rep_id', repId)
          .not('ended_at', 'is', null)
          .order('started_at', ascending: false)
          .limit(1)
          .maybeSingle();

      final startedAt = row?['started_at'] as String?;
      if (startedAt == null) return false;

      // `.toLocal()` before formatting, for the same UTC+2 reason as above.
      final closedOn = localDate(DateTime.parse(startedAt).toLocal());
      if (closedOn == today) {
        // Cache it so the answer survives losing signal later in the day.
        await _db.setValue(_closedKey(repId), closedOn);
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Records the day the closed workday started (see [hasClosedWorkdayToday]).
  Future<void> _recordWorkdayClosed(String repId, DateTime startedAt) =>
      _db.setValue(_closedKey(repId), localDate(startedAt.toLocal()));

  Future<WorkdaySession> startWorkday({
    required String orgId,
    required String repId,
  }) async {
    final position = await LocationService.getCurrentPosition();
    final clientId = _uuid.v4();
    final startedAt = DateTime.now();

    await _db.enqueue(
      entityType: OutboxType.workdayStart,
      clientGeneratedId: clientId,
      payload: jsonEncode({
        'org_id': orgId,
        'rep_id': repId,
        'started_at': startedAt.toUtc().toIso8601String(),
        'start_lat': position.latitude,
        'start_lng': position.longitude,
        'client_generated_id': clientId,
      }),
    );

    await queuePing(
      orgId: orgId,
      repId: repId,
      sessionClientId: clientId,
      position: position,
      source: 'workday_start',
    );

    unawaited(_sync.sync());

    final session = WorkdaySession(
      id: clientId,
      clientGeneratedId: clientId,
      orgId: orgId,
      repId: repId,
      startedAt: startedAt,
      distanceMeters: 0,
    );
    // Survives an app restart before the row ever reaches the server.
    await cacheActiveSession(session);
    return session;
  }

  /// Ends the day as of [endedAt].
  ///
  /// [position] is where the rep was: a fresh fix when they pressed End, the
  /// last one the trail saw when the day ended itself, or nothing at all.
  /// Only a rep's own end writes a `workday_end` ping — an automatic end
  /// happens at 19:30 whether or not the phone is awake, and a ping stamped
  /// with whenever it did wake would put the rep somewhere at a time they
  /// were not being tracked.
  ///
  /// [automatic] marks the row so the office can tell a day that ended itself
  /// from one the rep closed; a rep's own end clears the mark, because it is
  /// the one that stands even when the server closed the day first.
  Future<void> endWorkday({
    required String orgId,
    required String repId,
    required WorkdaySession session,
    required double distanceMeters,
    required DateTime endedAt,
    Position? position,
    bool automatic = false,
  }) async {
    if (position != null && !automatic) {
      await queuePing(
        orgId: orgId,
        repId: repId,
        sessionClientId: session.clientGeneratedId,
        position: position,
        source: 'workday_end',
      );
    }

    final duration = endedAt.difference(session.startedAt).inSeconds;
    await _db.enqueue(
      entityType: OutboxType.workdayEnd,
      clientGeneratedId: session.clientGeneratedId,
      payload: jsonEncode({
        'client_generated_id': session.clientGeneratedId,
        // Whose work this is, so the drain holds it for them (`ownerOf`).
        'rep_id': repId,
        'changes': {
          'ended_at': endedAt.toUtc().toIso8601String(),
          'end_lat': position?.latitude,
          'end_lng': position?.longitude,
          'distance_meters': distanceMeters,
          'duration_seconds': duration < 0 ? 0 : duration,
          'auto_ended_at': automatic
              ? DateTime.now().toUtc().toIso8601String()
              : null,
        },
      }),
    );

    await clearActiveSession(repId);
    // Recorded here, not when the outbox drains: the rep may be closing their
    // day with no signal, and the "one workday per day" rule has to hold from
    // the moment they tap the button.
    await _recordWorkdayClosed(repId, session.startedAt);
    // Only the rep's own end can be taken back. A day that ended itself did
    // so at the cut-off, and there is no day left to carry on with.
    if (automatic) {
      await _db.deleteValue(_lastEndedKey(repId));
    } else {
      await _db.setValue(
        _lastEndedKey(repId),
        jsonEncode(session.copyWith(distanceMeters: distanceMeters).toMap()),
      );
    }

    unawaited(_sync.sync());
  }

  /// The day [repId] ended themselves on this phone today, which they may
  /// still open again; null when there is none.
  ///
  /// Today's only: the one-workday-a-day rule is about the day the workday
  /// started, and yesterday's day is over whatever was tapped.
  Future<WorkdaySession?> endedToday(String repId) async {
    final raw = await _db.getValue(_lastEndedKey(repId));
    if (raw == null) return null;
    try {
      final session =
          WorkdaySession.fromMap(jsonDecode(raw) as Map<String, dynamic>);
      if (localDate(session.startedAt) == localDate(DateTime.now())) {
        return session;
      }
    } catch (_) {
      // Unreadable (a FormatException, or a TypeError from a copy missing a
      // field): nothing to offer, and no reason to break the day's banner.
    }
    await _db.deleteValue(_lastEndedKey(repId));
    return null;
  }

  /// Opens [session] again after the rep ended it by mistake (owner, 30 Oct
  /// 2026: a distributor's reps ended theirs by accident on their first morning,
  /// and only the office could put it right).
  ///
  /// The same workday carries on, rather than a second one starting, so "one
  /// workday a day" still holds and the day's hours and distance stay in one
  /// row. The time between the end and the restart counts as part of the day:
  /// the day never ended. Works with no signal, like the end it undoes: the
  /// reopening queues behind it and lands after it.
  Future<WorkdaySession> reopenWorkday({
    required String repId,
    required WorkdaySession session,
  }) async {
    await _db.enqueue(
      entityType: OutboxType.workdayReopen,
      clientGeneratedId: session.clientGeneratedId,
      payload: jsonEncode({
        'client_generated_id': session.clientGeneratedId,
        // Whose work this is, so the drain holds it for them (`ownerOf`).
        'rep_id': repId,
        'changes': {
          'ended_at': null,
          'end_lat': null,
          'end_lng': null,
          'duration_seconds': null,
          'auto_ended_at': null,
          'ended_by': null,
          'road_distance_meters': null,
          'road_distance_at': null,
          'road_distance_error': null,
        },
      }),
    );

    await cacheActiveSession(session);
    await _db.deleteValue(_closedKey(repId));
    await _db.deleteValue(_lastEndedKey(repId));

    unawaited(_sync.sync());
    return session;
  }

  /// Queues a location sample. The session is referenced by its client id;
  /// the sync engine resolves it to the real row once the workday lands.
  ///
  /// The session is **required**. A rep's position is recorded only while
  /// they are clocked in (POPIA: the requirements say "track location only
  /// while an employee is clocked in"). Until 1.1.12 a check-out after the day
  /// had ended, or after the day ended itself, still queued a ping with no
  /// session — a position taken outside working hours. Making the session
  /// non-nullable means no caller can do that again without the compiler
  /// saying so.
  Future<void> queuePing({
    required String orgId,
    required String repId,
    required String sessionClientId,
    required Position position,
    required String source,
  }) async {
    final clientId = _uuid.v4();
    await _db.enqueue(
      entityType: OutboxType.locationPing,
      clientGeneratedId: clientId,
      payload: jsonEncode({
        'org_id': orgId,
        'rep_id': repId,
        'workday_session_client_id': sessionClientId,
        'lat': position.latitude,
        'lng': position.longitude,
        'accuracy_m': position.accuracy,
        'recorded_at': DateTime.now().toUtc().toIso8601String(),
        'source': source,
        'client_generated_id': clientId,
      }),
    );
  }

  /// Captures an interval sample and returns the leg travelled since [last],
  /// so mileage accrues locally without needing the server.
  /// Records one interval ping.
  ///
  /// [position] is the fix the workday's location stream has already produced.
  /// Passing it matters for battery: taking a fresh high-accuracy fix here would
  /// wake the GPS chip a second time for a position we were just handed, which
  /// is exactly the drain `LocationTracking` is arranged to avoid. It stays
  /// optional so a caller with no stream — a one-off, or a test — still works.
  Future<({Position position, double legMeters})> recordIntervalPing({
    required String orgId,
    required String repId,
    required String sessionClientId,
    Position? last,
    Position? position,
  }) async {
    position ??= await LocationService.getCurrentPosition();
    await queuePing(
      orgId: orgId,
      repId: repId,
      sessionClientId: sessionClientId,
      position: position,
      source: 'interval',
    );
    unawaited(_sync.sync());

    final leg = last == null
        ? 0.0
        : LocationService.distanceBetween(
            last.latitude,
            last.longitude,
            position.latitude,
            position.longitude,
          );
    // Noise is not travel. Sampling on time rather than distance means a phone
    // sitting on a counter reports every five minutes, and each of those fixes
    // is metres from the last for no reason anybody drove — left unchecked that
    // walks the odometer kilometres in a day. The ping is still written; only
    // the distance is gated.
    return (position: position, legMeters: odometerLegMeters(leg));
  }
}
