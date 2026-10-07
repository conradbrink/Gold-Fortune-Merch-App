import 'dart:async';
import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../../core/location_service.dart';
import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/route_visit.dart';
import '../sync/sync_engine.dart';
import 'route_repository.dart';
import 'workday_repository.dart';

const _uuid = Uuid();

class CheckInResult {
  final String clientGeneratedId;
  final double? distanceFromStoreM;
  final bool outsideGeofence;

  /// No fresh GPS fix, so the check-in was recorded without a position.
  final bool noFix;

  const CheckInResult({
    required this.clientGeneratedId,
    this.distanceFromStoreM,
    required this.outsideGeofence,
    this.noFix = false,
  });
}

/// Visit writes are queued locally first, then synced. A rep standing in a
/// signal dead zone still gets an immediate, durable check-in.
class VisitRepository {
  VisitRepository(this._db, this._sync, this._workdayRepo, this._routeRepo);

  final AppDatabase _db;
  final SyncEngine _sync;
  final WorkdayRepository _workdayRepo;
  final RouteRepository _routeRepo;

  Future<CheckInResult> checkIn({
    required String orgId,
    required String repId,
    required RouteVisit routeVisit,
    String? workdaySessionClientId,
  }) async {
    // Null when only an old fix exists: the visit then records no position
    // rather than the last shop's (see LocationService.getCheckInPosition).
    final position = await LocationService.getCheckInPosition();

    double? distance;
    if (position != null &&
        routeVisit.storeLat != null &&
        routeVisit.storeLng != null) {
      distance = LocationService.distanceBetween(
        position.latitude,
        position.longitude,
        routeVisit.storeLat!,
        routeVisit.storeLng!,
      );
    }

    // Reuse the existing visit's key when the manager pre-created the row,
    // so we update rather than insert a parallel visit.
    final clientId = routeVisit.visitClientGeneratedId ?? _uuid.v4();
    final checkinAt = DateTime.now();

    await _db.enqueue(
      entityType: OutboxType.visitCheckIn,
      clientGeneratedId: clientId,
      payload: jsonEncode({
        'org_id': orgId,
        // Null for an unscheduled visit — `routes` stays a record of what was
        // planned, so planned-vs-actual reporting remains meaningful.
        'route_id': routeVisit.routeId,
        'rep_id': repId,
        'store_id': routeVisit.storeId,
        'status': 'checked_in',
        'checkin_at': checkinAt.toUtc().toIso8601String(),
        'checkin_lat': position?.latitude,
        'checkin_lng': position?.longitude,
        'checkin_gps_accuracy_m': position?.accuracy,
        'checkin_distance_from_store_m': distance,
        'client_generated_id': clientId,
      }),
    );

    // Only inside an open workday: outside one, the rep is not clocked in
    // and their position is not recorded. The visit row keeps its own
    // coordinates either way — that is the visit's evidence, not a trail.
    final session = workdaySessionClientId;
    if (session != null && position != null) {
      await _workdayRepo.queuePing(
        orgId: orgId,
        repId: repId,
        sessionClientId: session,
        position: position,
        source: 'checkin',
      );
    }

    // Write the new state into the route cache. Without this the offline UI
    // re-reads the stale cached row, still shows "not started", and a rep who
    // taps Check in again mints a second client id — a duplicate visit.
    await _routeRepo.applyLocalVisitChange(
      routeVisit.copyWith(
        status: 'checked_in',
        visitClientGeneratedId: clientId,
        checkinAt: checkinAt,
      ),
    );

    unawaited(_sync.sync());

    return CheckInResult(
      clientGeneratedId: clientId,
      distanceFromStoreM: distance,
      outsideGeofence:
          distance != null && distance > routeVisit.geofenceRadiusM,
      noFix: position == null,
    );
  }

  Future<void> checkOut({
    required String orgId,
    required String repId,
    required RouteVisit routeVisit,
    String? workdaySessionClientId,
  }) async {
    final clientId = routeVisit.visitClientGeneratedId;
    if (clientId == null) {
      throw StateError('Cannot check out before checking in.');
    }

    final position = await LocationService.getCurrentPosition();
    final checkoutAt = DateTime.now();
    final durationSeconds = routeVisit.checkinAt != null
        ? checkoutAt.difference(routeVisit.checkinAt!).inSeconds
        : null;

    await _db.enqueue(
      entityType: OutboxType.visitCheckOut,
      clientGeneratedId: clientId,
      payload: jsonEncode({
        'client_generated_id': clientId,
        'changes': {
          'status': 'checked_out',
          'checkout_at': checkoutAt.toUtc().toIso8601String(),
          'checkout_lat': position.latitude,
          'checkout_lng': position.longitude,
          'duration_seconds': durationSeconds,
        },
      }),
    );

    // Only inside an open workday: outside one, the rep is not clocked in
    // and their position is not recorded. The visit row keeps its own
    // coordinates either way — that is the visit's evidence, not a trail.
    final session = workdaySessionClientId;
    if (session != null) {
      await _workdayRepo.queuePing(
        orgId: orgId,
        repId: repId,
        sessionClientId: session,
        position: position,
        source: 'checkout',
      );
    }

    await _routeRepo.applyLocalVisitChange(
      routeVisit.copyWith(status: 'checked_out', checkoutAt: checkoutAt),
    );

    unawaited(_sync.sync());
  }
}
