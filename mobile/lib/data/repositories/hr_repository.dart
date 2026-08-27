import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../models/hr.dart';

/// The rep's own HR record.
///
/// **Online only, and deliberately so.** Everything else the app does is built
/// to work in a shop with no signal, because the rep is standing in front of a
/// shelf and the work cannot wait. Leave is not that: it is filed from a
/// kitchen table, it needs a photograph of a sick note to go with it, and a
/// request queued offline would sit on the handset while the person believes
/// they have told somebody they are ill. A clear "you need signal for this" is
/// the honest failure; a silent queue is not.
///
/// Nothing here decides access. `hr_my_employee_id()` returns this caller's own
/// employee row and RLS narrows every table to it, so a rep reading their
/// balances gets their balances and a request aimed at somebody else is refused
/// by the database rather than by an `if` on the phone.
class HrRepository {
  HrRepository(this._client);

  final SupabaseClient _client;
  static const _bucket = 'hr-documents';
  static const _uuid = Uuid();

  /// This rep's employee id, or null when nobody has made them an employee yet.
  ///
  /// A real state, not an error: the HR module links an employee to a login and
  /// somebody joining mid-month has an account before they have a record. The
  /// screen says so rather than showing an empty balance that reads as nought
  /// days of leave.
  Future<String?> myEmployeeId() async {
    final id = await _client.rpc('hr_my_employee_id');
    return id as String?;
  }

  Future<List<LeaveType>> leaveTypes() async {
    final rows = await _client
        .from('hr_leave_types')
        .select('id, name, is_paid, requires_document, deducts_from_balance')
        .eq('active', true)
        .order('sort_order');
    return [
      for (final r in rows as List) LeaveType.fromMap(r as Map<String, dynamic>),
    ];
  }

  Future<List<LeaveBalance>> balances(String employeeId) async {
    final rows = await _client
        .from('hr_leave_balance_summary')
        .select(
          'leave_type_id, leave_type_name, deducts_from_balance, '
          'entitlement_days, used_days, pending_days, remaining_days',
        )
        .eq('employee_id', employeeId);
    return [
      for (final r in rows as List) LeaveBalance.fromMap(r as Map<String, dynamic>),
    ];
  }

  Future<List<LeaveRequest>> requests(String employeeId) async {
    final rows = await _client
        .from('hr_leave_requests')
        .select(
          'id, start_date, end_date, days, status, reason, decision_note, '
          'document_path, leave_type:hr_leave_types(name)',
        )
        .eq('employee_id', employeeId)
        .order('start_date', ascending: false);
    return [
      for (final r in rows as List) LeaveRequest.fromMap(r as Map<String, dynamic>),
    ];
  }

  Future<List<Warning>> warnings(String employeeId) async {
    final rows = await _client
        .from('hr_warnings')
        .select(
          'id, warning_type, issued_on, reason, expires_on, '
          'acknowledged_at, document_path',
        )
        .eq('employee_id', employeeId)
        .order('issued_on', ascending: false);
    return [
      for (final r in rows as List) Warning.fromMap(r as Map<String, dynamic>),
    ];
  }

  /// How many working days a span covers, asked of the server.
  ///
  /// Not counted on the phone. Weekends are configurable per organisation and
  /// public holidays are a table, so an app that counted them itself would be
  /// right until somebody changed either — and wrong silently, on the number a
  /// leave balance is decremented by.
  Future<double> workingDays(String orgId, DateTime from, DateTime to) async {
    final days = await _client.rpc('hr_working_days', params: {
      'p_org': orgId,
      'p_from': _date(from),
      'p_to': _date(to),
    });
    return (days as num?)?.toDouble() ?? 0;
  }

  /// Uploads a supporting document into this employee's own folder.
  ///
  /// The second path segment is the check, not a convention: the bucket's
  /// insert policy reads it and refuses an upload aimed at an employee the
  /// caller may not see.
  Future<String> uploadDocument({
    required String orgId,
    required String employeeId,
    required File file,
    required String fileName,
  }) async {
    final safe = fileName.replaceAll(RegExp(r'[^\w.\-]+'), '_');
    final path = '$orgId/$employeeId/leave/${_uuid.v4()}-$safe';
    await _client.storage.from(_bucket).upload(path, file);
    return path;
  }

  Future<void> fileLeave({
    required String orgId,
    required String employeeId,
    required String leaveTypeId,
    required DateTime from,
    required DateTime to,
    required double days,
    required String? reason,
    required String? documentPath,
  }) async {
    await _client.from('hr_leave_requests').insert({
      'org_id': orgId,
      'employee_id': employeeId,
      'leave_type_id': leaveTypeId,
      'start_date': _date(from),
      'end_date': _date(to),
      'days': days,
      'reason': reason,
      'document_path': documentPath,
      // Status is left to its default. The allowlist of permitted transitions
      // lives in a trigger, and a client naming its own starting status is the
      // first step towards a client naming 'approved'.
    });
  }

  /// Takes back a request nobody has decided yet.
  Future<void> withdraw(String requestId) async {
    await _client
        .from('hr_leave_requests')
        .update({'status': 'withdrawn'})
        .eq('id', requestId);
  }

  /// "I have seen this." Not agreement, and the screen says so.
  ///
  /// The timestamp sent is a placeholder the server trigger overwrites with its
  /// own `now()`, exactly as the web module does — an acknowledgement dated by
  /// a handset whose clock is wrong is worse than none.
  Future<void> acknowledgeWarning(String warningId) async {
    await _client
        .from('hr_warnings')
        .update({'acknowledged_at': DateTime.now().toUtc().toIso8601String()})
        .eq('id', warningId);
  }

  /// A short-lived link to a document, for viewing it in the OS viewer.
  Future<String> signedUrl(String path) =>
      _client.storage.from(_bucket).createSignedUrl(path, 60);

  static String _date(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
