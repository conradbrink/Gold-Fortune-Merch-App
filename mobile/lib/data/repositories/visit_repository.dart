import 'dart:async';
import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../../core/location_service.dart';
import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/route_visit.dart';
import '../sync/sync_engine.dart';
import 'workday_repository.dart';

const _uuid = Uuid();

class CheckInResult {
  final String clientGeneratedId;
  final double? distanceFromStoreM;
  final bool outsideGeofence;

  const CheckInResult({
    required this.clientGeneratedId,
    this.distanceFromStoreM,
    required this.outsideGeofence,
  });
}

/// Visit writes are queued locally first, then synced. A rep standing in a
/// signal dead zone still gets an immediate, durable check-in.
class VisitRepository {
  VisitRepository(this._db, this._sync, this._workdayRepo);

  final AppDatabase _db;
  final SyncEngine _sync;
  final WorkdayRepository _workdayRepo;

  Future<CheckInResult> checkIn({
    required String orgId,
    required String repId,
    required RouteVisit routeVisit,
    String? workdaySessionClientId,
  }) async {
    final position = await LocationService.getCurrentPosition();

    double? distance;
    if (routeVisit.storeLat != null && routeVisit.storeLng != null) {
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

    await _db.enqueue(
      entityType: OutboxType.visitCheckIn,
      clientGeneratedId: clientId,
      payload: jsonEncode({
        'org_id': orgId,
        'route_id': routeVisit.routeId,
        'rep_id': repId,
        'store_id': routeVisit.storeId,
        'status': 'checked_in',
        'checkin_at': DateTime.now().toUtc().toIso8601String(),
        'checkin_lat': position.latitude,
        'checkin_lng': position.longitude,
        'checkin_gps_accuracy_m': position.accuracy,
        'checkin_distance_from_store_m': distance,
        'client_generated_id': clientId,
      }),
    );

    await _workdayRepo.queuePing(
      orgId: orgId,
      repId: repId,
      sessionClientId: workdaySessionClientId,
      position: position,
      source: 'checkin',
    );

    unawaited(_sync.sync());

    return CheckInResult(
      clientGeneratedId: clientId,
      distanceFromStoreM: distance,
      outsideGeofence:
          distance != null && distance > routeVisit.geofenceRadiusM,
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
      throw StateError('Cannot check out of a visit that was never started.');
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

    await _workdayRepo.queuePing(
      orgId: orgId,
      repId: repId,
      sessionClientId: workdaySessionClientId,
      position: position,
      source: 'checkout',
    );

    unawaited(_sync.sync());
  }
}
