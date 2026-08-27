// The rep's own HR record, as the phone needs it.
//
// Deliberately a thin read of what the web module already computes. Nothing
// here derives a balance, decides whether a request is allowed, or works out
// how many working days a period covers — `hr_leave_balance_summary` and
// `hr_working_days()` do all three on the server, and a second implementation
// on a handset that ships on its own release cycle is how the two start
// disagreeing about somebody's leave.

class LeaveType {
  const LeaveType({
    required this.id,
    required this.name,
    required this.isPaid,
    required this.requiresDocument,
    required this.deductsFromBalance,
  });

  final String id;
  final String name;
  final bool isPaid;

  /// Sick leave, typically. The database refuses a request with no document
  /// when this is set; the form asks first so nobody types out a reason and
  /// then loses it to a refusal.
  final bool requiresDocument;
  final bool deductsFromBalance;

  factory LeaveType.fromMap(Map<String, dynamic> m) => LeaveType(
        id: m['id'] as String,
        name: m['name'] as String,
        isPaid: (m['is_paid'] as bool?) ?? true,
        requiresDocument: (m['requires_document'] as bool?) ?? false,
        deductsFromBalance: (m['deducts_from_balance'] as bool?) ?? true,
      );
}

class LeaveBalance {
  const LeaveBalance({
    required this.leaveTypeId,
    required this.leaveTypeName,
    required this.entitlementDays,
    required this.usedDays,
    required this.pendingDays,
    required this.remainingDays,
    required this.deductsFromBalance,
  });

  final String leaveTypeId;
  final String leaveTypeName;
  final double entitlementDays;
  final double usedDays;
  final double pendingDays;
  final double remainingDays;
  final bool deductsFromBalance;

  static double _num(Object? v) => (v as num?)?.toDouble() ?? 0;

  factory LeaveBalance.fromMap(Map<String, dynamic> m) => LeaveBalance(
        leaveTypeId: m['leave_type_id'] as String,
        leaveTypeName: (m['leave_type_name'] as String?) ?? 'Leave',
        entitlementDays: _num(m['entitlement_days']),
        usedDays: _num(m['used_days']),
        pendingDays: _num(m['pending_days']),
        remainingDays: _num(m['remaining_days']),
        deductsFromBalance: (m['deducts_from_balance'] as bool?) ?? true,
      );
}

class LeaveRequest {
  const LeaveRequest({
    required this.id,
    required this.leaveTypeName,
    required this.startDate,
    required this.endDate,
    required this.days,
    required this.status,
    required this.reason,
    required this.decisionNote,
    required this.hasDocument,
  });

  final String id;
  final String leaveTypeName;
  final DateTime startDate;
  final DateTime endDate;
  final double days;

  /// `pending`, `approved`, `rejected`, `cancelled`, `withdrawn`.
  final String status;
  final String? reason;
  final String? decisionNote;
  final bool hasDocument;

  /// Only a pending request is the rep's to take back. Every other transition
  /// belongs to whoever decides it, and the database says so — this just avoids
  /// offering a button that would be refused.
  bool get canWithdraw => status == 'pending';

  factory LeaveRequest.fromMap(Map<String, dynamic> m) {
    final type = m['leave_type'] as Map<String, dynamic>?;
    return LeaveRequest(
      id: m['id'] as String,
      leaveTypeName: (type?['name'] as String?) ?? 'Leave',
      startDate: DateTime.parse(m['start_date'] as String),
      endDate: DateTime.parse(m['end_date'] as String),
      days: (m['days'] as num?)?.toDouble() ?? 0,
      status: (m['status'] as String?) ?? 'pending',
      reason: m['reason'] as String?,
      decisionNote: m['decision_note'] as String?,
      hasDocument: (m['document_path'] as String?) != null,
    );
  }
}

class Warning {
  const Warning({
    required this.id,
    required this.warningType,
    required this.issuedOn,
    required this.reason,
    required this.expiresOn,
    required this.acknowledgedAt,
    required this.documentPath,
  });

  final String id;
  final String warningType;
  final DateTime issuedOn;
  final String reason;
  final DateTime? expiresOn;
  final DateTime? acknowledgedAt;

  /// The signed letter, where there is one. Verbal warnings have none, and the
  /// database only insists on it for the types HR has flagged.
  final String? documentPath;

  bool get acknowledged => acknowledgedAt != null;
  bool get hasDocument => documentPath != null;

  factory Warning.fromMap(Map<String, dynamic> m) => Warning(
        id: m['id'] as String,
        warningType: (m['warning_type'] as String?) ?? 'other',
        issuedOn: DateTime.parse(m['issued_on'] as String),
        reason: (m['reason'] as String?) ?? '',
        expiresOn: m['expires_on'] == null
            ? null
            : DateTime.parse(m['expires_on'] as String),
        acknowledgedAt: m['acknowledged_at'] == null
            ? null
            : DateTime.parse(m['acknowledged_at'] as String),
        documentPath: m['document_path'] as String?,
      );
}
