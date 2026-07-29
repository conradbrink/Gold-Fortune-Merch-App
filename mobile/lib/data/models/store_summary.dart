/// A store the rep can start an unscheduled visit at. Cached locally so the
/// picker still works with no connection — improvising a visit is exactly the
/// situation where a rep is least likely to have signal.
class StoreSummary {
  final String id;
  final String name;
  final String? address;
  final String? city;
  final String? state;
  final double? lat;
  final double? lng;
  /// Provenance of [lat]/[lng] — see `RouteVisit.storeGeocodeSource`. Carried
  /// so an unscheduled visit can offer to fix a guessed position too.
  final String? geocodeSource;
  final int geofenceRadiusM;

  const StoreSummary({
    required this.id,
    required this.name,
    this.address,
    this.city,
    this.state,
    this.lat,
    this.lng,
    this.geocodeSource,
    required this.geofenceRadiusM,
  });

  String get location =>
      [address, city, state].where((s) => s != null && s.isNotEmpty).join(', ');

  Map<String, dynamic> toMap() => {
        'id': id,
        'name': name,
        'address': address,
        'city': city,
        'state': state,
        'lat': lat,
        'lng': lng,
        'geocode_source': geocodeSource,
        'geofence_radius_m': geofenceRadiusM,
      };

  factory StoreSummary.fromMap(Map<String, dynamic> map) {
    return StoreSummary(
      id: map['id'] as String,
      name: map['name'] as String,
      address: map['address'] as String?,
      city: map['city'] as String?,
      state: map['state'] as String?,
      lat: (map['lat'] as num?)?.toDouble(),
      lng: (map['lng'] as num?)?.toDouble(),
      geocodeSource: map['geocode_source'] as String?,
      geofenceRadiusM: (map['geofence_radius_m'] as num?)?.toInt() ?? 100,
    );
  }
}
