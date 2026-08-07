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

  /// A sales call on a prospect. Split in two the same way a visit is: the
  /// start inserts the row, the completion fills in what came of it. They
  /// share the call's client id, so the drain will not replay the completion
  /// without the start that created the row.
  static const salesVisitStart = 'sales_visit_start';
  static const salesVisitComplete = 'sales_visit_complete';

  /// Composite: the order header and every line, as one entry.
  ///
  /// Kept together for the reason a form submission is — an order that landed
  /// with half its lines is worse than one that has not landed at all, because
  /// the warehouse would pick it and nobody would know what was missing.
  ///
  /// The order *number* is drawn during the replay, not when the rep taps save.
  /// It comes from a gapless per-organisation counter on the server, and a
  /// number handed out on a phone that is offline for two days would arrive
  /// out of sequence — or twice, if two reps were offline at once.
  static const orderCreate = 'order_create';
}
