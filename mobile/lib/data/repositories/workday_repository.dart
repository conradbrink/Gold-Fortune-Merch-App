import 'dart:async';
import 'dart:convert';

import 'package:geolocator/geolocator.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/location_service.dart';
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
      // is still queued — otherwise the day genuinely ended elsewhere.
      if (local != null && await _hasPendingStart(local.clientGeneratedId)) {
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

  Future<bool> _hasPendingStart(String clientGeneratedId) async {
    final pending = await _db.pendingEntries(limit: 1000);
    return pending.any((e) =>
        e.entityType == OutboxType.workdayStart &&
        e.clientGeneratedId == clientGeneratedId);
  }

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
      final row = await _client
          .from('workday_sessions')
          .select('ended_at')
          .eq('rep_id', repId)
          .not('ended_at', 'is', null)
          .order('ended_at', ascending: false)
          .limit(1)
          .maybeSingle();

      final endedAt = row?['ended_at'] as String?;
      if (endedAt == null) return false;

      // `.toLocal()` before formatting, for the same UTC+2 reason as above.
      final closedOn = localDate(DateTime.parse(endedAt).toLocal());
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

  Future<void> _recordWorkdayClosed(String repId, DateTime endedAt) =>
      _db.setValue(_closedKey(repId), localDate(endedAt));

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

  Future<void> endWorkday({
    required String orgId,
    required String repId,
    required WorkdaySession session,
    required double distanceMeters,
  }) async {
    final position = await LocationService.getCurrentPosition();
    final endedAt = DateTime.now();

    await queuePing(
      orgId: orgId,
      repId: repId,
      sessionClientId: session.clientGeneratedId,
      position: position,
      source: 'workday_end',
    );

    await _db.enqueue(
      entityType: OutboxType.workdayEnd,
      clientGeneratedId: session.clientGeneratedId,
      payload: jsonEncode({
        'client_generated_id': session.clientGeneratedId,
        'changes': {
          'ended_at': endedAt.toUtc().toIso8601String(),
          'end_lat': position.latitude,
          'end_lng': position.longitude,
          'distance_meters': distanceMeters,
          'duration_seconds': endedAt.difference(session.startedAt).inSeconds,
        },
      }),
    );

    await clearActiveSession(repId);
    // Recorded here, not when the outbox drains: the rep may be closing their
    // day with no signal, and the "one workday per day" rule has to hold from
    // the moment they tap the button.
    await _recordWorkdayClosed(repId, endedAt);

    unawaited(_sync.sync());
  }

  /// Queues a location sample. The session is referenced by its client id;
  /// the sync engine resolves it to the real row once the workday lands.
  Future<void> queuePing({
    required String orgId,
    required String repId,
    String? sessionClientId,
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
  Future<({Position position, double legMeters})> recordIntervalPing({
    required String orgId,
    required String repId,
    required String sessionClientId,
    Position? last,
  }) async {
    final position = await LocationService.getCurrentPosition();
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
    return (position: position, legMeters: leg);
  }
}
