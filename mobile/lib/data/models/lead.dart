/// A sales call on a shop that is not a customer yet.
///
/// Deliberately not a [RouteVisit]. A visit is about a store row — it has a
/// geofence, a form and a place in the day's plan. This is the opposite case:
/// the whole point is that the shop is not on the estate, so there is no store
/// to point at and nothing to measure the rep's distance against.
///
/// [clientGeneratedId] is the identity. The row on the server is keyed on it,
/// so a call recorded in a dead zone and a call recorded on a good signal are
/// the same record either way.
class Lead {
  final String clientGeneratedId;
  final String orgId;
  final String repId;

  // Taken on the way in.
  final String companyName;
  final String purpose;
  final String? contactName;
  final String? contactPhone;
  final DateTime startedAt;
  final double? startLat;
  final double? startLng;

  // Taken on the way out.
  final String? outcome;
  final String? notes;
  final bool followUpRequired;
  /// Local date, `yyyy-MM-dd`. Never a DateTime: Botswana is UTC+2 and a round
  /// trip through UTC moves a follow-up to the day before.
  final String? followUpOn;
  final DateTime? completedAt;
  final double? endLat;
  final double? endLng;

  /// 'in_progress' until the rep closes it off.
  final String status;

  const Lead({
    required this.clientGeneratedId,
    required this.orgId,
    required this.repId,
    required this.companyName,
    required this.purpose,
    this.contactName,
    this.contactPhone,
    required this.startedAt,
    this.startLat,
    this.startLng,
    this.outcome,
    this.notes,
    this.followUpRequired = false,
    this.followUpOn,
    this.completedAt,
    this.endLat,
    this.endLng,
    this.status = 'in_progress',
  });

  bool get isComplete => status == 'completed';

  Lead copyWith({
    String? outcome,
    String? notes,
    bool? followUpRequired,
    String? followUpOn,
    DateTime? completedAt,
    double? endLat,
    double? endLng,
    String? status,
  }) {
    return Lead(
      clientGeneratedId: clientGeneratedId,
      orgId: orgId,
      repId: repId,
      companyName: companyName,
      purpose: purpose,
      contactName: contactName,
      contactPhone: contactPhone,
      startedAt: startedAt,
      startLat: startLat,
      startLng: startLng,
      outcome: outcome ?? this.outcome,
      notes: notes ?? this.notes,
      followUpRequired: followUpRequired ?? this.followUpRequired,
      // Explicitly clearable: unticking follow-up has to be able to remove the
      // date, and the server refuses a date without the flag.
      followUpOn: followUpRequired == false ? null : (followUpOn ?? this.followUpOn),
      completedAt: completedAt ?? this.completedAt,
      endLat: endLat ?? this.endLat,
      endLng: endLng ?? this.endLng,
      status: status ?? this.status,
    );
  }

  Map<String, dynamic> toMap() => {
        'client_generated_id': clientGeneratedId,
        'org_id': orgId,
        'rep_id': repId,
        'company_name': companyName,
        'purpose': purpose,
        'contact_name': contactName,
        'contact_phone': contactPhone,
        'started_at': startedAt.toIso8601String(),
        'start_lat': startLat,
        'start_lng': startLng,
        'outcome': outcome,
        'notes': notes,
        'follow_up_required': followUpRequired,
        'follow_up_on': followUpOn,
        'completed_at': completedAt?.toIso8601String(),
        'end_lat': endLat,
        'end_lng': endLng,
        'status': status,
      };

  factory Lead.fromMap(Map<String, dynamic> map) => Lead(
        clientGeneratedId: map['client_generated_id'] as String,
        orgId: map['org_id'] as String,
        repId: map['rep_id'] as String,
        companyName: map['company_name'] as String,
        purpose: map['purpose'] as String,
        contactName: map['contact_name'] as String?,
        contactPhone: map['contact_phone'] as String?,
        startedAt: DateTime.parse(map['started_at'] as String),
        startLat: (map['start_lat'] as num?)?.toDouble(),
        startLng: (map['start_lng'] as num?)?.toDouble(),
        outcome: map['outcome'] as String?,
        notes: map['notes'] as String?,
        followUpRequired: (map['follow_up_required'] as bool?) ?? false,
        followUpOn: map['follow_up_on'] as String?,
        completedAt: map['completed_at'] == null
            ? null
            : DateTime.parse(map['completed_at'] as String),
        endLat: (map['end_lat'] as num?)?.toDouble(),
        endLng: (map['end_lng'] as num?)?.toDouble(),
        status: (map['status'] as String?) ?? 'in_progress',
      );
}
