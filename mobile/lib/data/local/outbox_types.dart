/// Operation kinds the sync engine knows how to replay. Kept as constants
/// (not an enum) so entries written by an older build still resolve after an
/// app update.
class OutboxType {
  static const visitCheckIn = 'visit_check_in';
  static const visitCheckOut = 'visit_check_out';
  static const workdayStart = 'workday_start';
  static const workdayEnd = 'workday_end';
  static const locationPing = 'location_ping';

  /// Composite: uploads any photos, then inserts the submission and all of
  /// its responses. Kept as one entry so a form never lands half-written.
  static const formSubmission = 'form_submission';

  /// A rep's answer on one promoted line at one store: running, not running,
  /// or the shop does not carry it. One entry per answer — unlike a form there
  /// is nothing composite about it, and batching them would only mean a single
  /// bad row could hold back the rest.
  static const promotionCheck = 'promotion_check';
}
