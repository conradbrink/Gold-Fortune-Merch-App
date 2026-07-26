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

const _uuid = Uuid();

class WorkdayRepository {
  WorkdayRepository(this._client, this._db, this._sync);

  final SupabaseClient _client;
  final AppDatabase _db;
  final SyncEngine _sync;

  /// Server-side lookup; returns null when offline. The controller keeps its
  /// own local record so an offline start still shows as in progress.
  Future<WorkdaySession?> fetchActiveSession(String repId) async {
    try {
      final row = await _client
          .from('workday_sessions')
          .select()
          .eq('rep_id', repId)
          .isFilter('ended_at', null)
          .order('started_at', ascending: false)
          .limit(1)
          .maybeSingle();
      return row == null ? null : WorkdaySession.fromMap(row);
    } catch (_) {
      return null;
    }
  }

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

    return WorkdaySession(
      id: clientId,
      clientGeneratedId: clientId,
      orgId: orgId,
      repId: repId,
      startedAt: startedAt,
      distanceMeters: 0,
    );
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
