/// A single row on the rep's "today" list: a scheduled `routes` entry joined
/// with its `stores` row and (if it exists yet) the corresponding `visits`
/// row. A visit row is created lazily on check-in, so it may be null.
class RouteVisit {
  final String routeId;
  final String storeId;
  final String storeName;
  final String? storeAddress;
  final String? storeCity;
  final String? storeState;
  final double? storeLat;
  final double? storeLng;
  final int geofenceRadiusM;
  final DateTime? scheduledStartAt;
  final DateTime? scheduledEndAt;

  final String? visitId;
  /// The offline idempotency key. Present even before a visit has synced,
  /// which is how check-out and form submissions refer to it.
  final String? visitClientGeneratedId;
  final String status; // not_started | checked_in | checked_out | missed
  final DateTime? checkinAt;
  final DateTime? checkoutAt;

  const RouteVisit({
    required this.routeId,
    required this.storeId,
    required this.storeName,
    this.storeAddress,
    this.storeCity,
    this.storeState,
    this.storeLat,
    this.storeLng,
    required this.geofenceRadiusM,
    this.scheduledStartAt,
    this.scheduledEndAt,
    this.visitId,
    this.visitClientGeneratedId,
    required this.status,
    this.checkinAt,
    this.checkoutAt,
  });

  bool get isCheckedIn => status == 'checked_in';
  bool get isCheckedOut => status == 'checked_out';
  bool get isMissed => status == 'missed';

  /// Round-trips through the same shape [fromMap] reads, so the local cache
  /// can store rows verbatim and rebuild them offline.
  Map<String, dynamic> toMap() => {
        'id': routeId,
        'store_id': storeId,
        'scheduled_start_at': scheduledStartAt?.toUtc().toIso8601String(),
        'scheduled_end_at': scheduledEndAt?.toUtc().toIso8601String(),
        'stores': {
          'name': storeName,
          'address': storeAddress,
          'city': storeCity,
          'state': storeState,
          'lat': storeLat,
          'lng': storeLng,
          'geofence_radius_m': geofenceRadiusM,
        },
        'visits': [
          {
            'id': visitId,
            'client_generated_id': visitClientGeneratedId,
            'status': status,
            'checkin_at': checkinAt?.toUtc().toIso8601String(),
            'checkout_at': checkoutAt?.toUtc().toIso8601String(),
          }
        ],
      };

  RouteVisit copyWith({
    String? status,
    String? visitClientGeneratedId,
    DateTime? checkinAt,
    DateTime? checkoutAt,
  }) {
    return RouteVisit(
      routeId: routeId,
      storeId: storeId,
      storeName: storeName,
      storeAddress: storeAddress,
      storeCity: storeCity,
      storeState: storeState,
      storeLat: storeLat,
      storeLng: storeLng,
      geofenceRadiusM: geofenceRadiusM,
      scheduledStartAt: scheduledStartAt,
      scheduledEndAt: scheduledEndAt,
      visitId: visitId,
      visitClientGeneratedId:
          visitClientGeneratedId ?? this.visitClientGeneratedId,
      status: status ?? this.status,
      checkinAt: checkinAt ?? this.checkinAt,
      checkoutAt: checkoutAt ?? this.checkoutAt,
    );
  }

  factory RouteVisit.fromMap(Map<String, dynamic> map) {
    final store = map['stores'] as Map<String, dynamic>?;
    final visits = map['visits'] as List<dynamic>?;
    final visit = (visits != null && visits.isNotEmpty)
        ? visits.first as Map<String, dynamic>
        : null;

    return RouteVisit(
      routeId: map['id'] as String,
      storeId: map['store_id'] as String,
      storeName: store?['name'] as String? ?? 'Unknown store',
      storeAddress: store?['address'] as String?,
      storeCity: store?['city'] as String?,
      storeState: store?['state'] as String?,
      storeLat: (store?['lat'] as num?)?.toDouble(),
      storeLng: (store?['lng'] as num?)?.toDouble(),
      geofenceRadiusM: (store?['geofence_radius_m'] as num?)?.toInt() ?? 100,
      scheduledStartAt: map['scheduled_start_at'] != null
          ? DateTime.parse(map['scheduled_start_at'] as String).toLocal()
          : null,
      scheduledEndAt: map['scheduled_end_at'] != null
          ? DateTime.parse(map['scheduled_end_at'] as String).toLocal()
          : null,
      visitId: visit?['id'] as String?,
      visitClientGeneratedId: visit?['client_generated_id'] as String?,
      status: visit?['status'] as String? ?? 'not_started',
      checkinAt: visit?['checkin_at'] != null
          ? DateTime.parse(visit!['checkin_at'] as String).toLocal()
          : null,
      checkoutAt: visit?['checkout_at'] != null
          ? DateTime.parse(visit!['checkout_at'] as String).toLocal()
          : null,
    );
  }
}
