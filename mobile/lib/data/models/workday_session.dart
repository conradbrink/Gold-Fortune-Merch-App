class WorkdaySession {
  final String id;

  /// Offline idempotency key. For a session started offline this is also
  /// what [id] holds until the row syncs and gets its server-side uuid.
  final String clientGeneratedId;
  final String orgId;
  final String repId;
  final DateTime startedAt;
  final DateTime? endedAt;
  final double distanceMeters;
  final int? durationSeconds;

  const WorkdaySession({
    required this.id,
    required this.clientGeneratedId,
    required this.orgId,
    required this.repId,
    required this.startedAt,
    this.endedAt,
    required this.distanceMeters,
    this.durationSeconds,
  });

  bool get isActive => endedAt == null;

  double get distanceKm => distanceMeters / 1000;

  Duration get elapsed => (endedAt ?? DateTime.now()).difference(startedAt);

  WorkdaySession copyWith({double? distanceMeters}) {
    return WorkdaySession(
      id: id,
      clientGeneratedId: clientGeneratedId,
      orgId: orgId,
      repId: repId,
      startedAt: startedAt,
      endedAt: endedAt,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      durationSeconds: durationSeconds,
    );
  }

  /// Mirrors the server column names so the same [fromMap] reads both a
  /// Supabase row and a locally cached copy.
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'client_generated_id': clientGeneratedId,
      'org_id': orgId,
      'rep_id': repId,
      'started_at': startedAt.toUtc().toIso8601String(),
      'ended_at': endedAt?.toUtc().toIso8601String(),
      'distance_meters': distanceMeters,
      'duration_seconds': durationSeconds,
    };
  }

  factory WorkdaySession.fromMap(Map<String, dynamic> map) {
    return WorkdaySession(
      id: map['id'] as String,
      clientGeneratedId: map['client_generated_id'] as String,
      orgId: map['org_id'] as String,
      repId: map['rep_id'] as String,
      startedAt: DateTime.parse(map['started_at'] as String).toLocal(),
      endedAt: map['ended_at'] != null
          ? DateTime.parse(map['ended_at'] as String).toLocal()
          : null,
      distanceMeters: (map['distance_meters'] as num?)?.toDouble() ?? 0,
      durationSeconds: (map['duration_seconds'] as num?)?.toInt(),
    );
  }
}
