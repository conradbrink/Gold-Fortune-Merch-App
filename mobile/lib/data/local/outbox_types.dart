import 'dart:convert';

/// Operation kinds the sync engine knows how to replay. Kept as constants
/// (not an enum) so entries written by an older build still resolve after an
/// app update.
class OutboxType {
  static const visitCheckIn = 'visit_check_in';
  static const visitCheckOut = 'visit_check_out';
  static const workdayStart = 'workday_start';
  static const workdayEnd = 'workday_end';

  /// The rep's own end of today's workday, taken back: they ended it by
  /// mistake. Shares the session's client id, so it waits behind that
  /// session's start and end, and lands after them.
  static const workdayReopen = 'workday_reopen';
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

  /// Why a store did not order when the rep asked (`order_declines`).
  ///
  /// No parent to wait for: the row names its store, and the visit only by the
  /// phone's own id for it, which needs no lookup. One per visit; the server
  /// keeps the first.
  static const orderDecline = 'order_decline';

  /// Damaged stock found at a store (`damage_reports`), with its photo.
  ///
  /// Waits for its check-in, as a form does: the photo is filed against the
  /// visit, and the visit's server id only exists once the check-in lands.
  static const damageReport = 'damage_report';

  /// The driver records a delivery with its proof: who received it, and a
  /// photo of the signed delivery note (`delivery_confirm()`).
  ///
  /// Keyed by the dispatch id, so the delivery screen can tell it is waiting
  /// on this phone. The photo uploads first; the call refuses without it.
  static const deliveryConfirm = 'delivery_confirm';

  /// A customer the rep added on the phone (`store_add_from_phone()`).
  ///
  /// Keyed by the store id the phone made, which the check-in and the order
  /// queued behind it already name. Anything carrying that `store_id` waits
  /// for this entry (see `dependencyKeyOf`), so an order never reaches the
  /// server for a customer it has not heard of yet.
  static const storeAdd = 'store_add';
}

/// One queued operation, named by what it is and what it is about.
///
/// The sync engine needs to ask "is the workday start for session X still on
/// this phone?" and the answer is not "is X's id in the queue" — a session's
/// *end* carries the same id. Keying by type as well is what tells them apart.
String outboxEntryKey(String entityType, String clientGeneratedId) =>
    '$entityType:$clientGeneratedId';

/// The rep a queued payload was written by (`rep_id`), or null when it does
/// not say, which is read as "anyone's". The one rule for whose work an entry
/// is: the drain holds others' back, the count shows only the signed-in
/// person's, and the schema 5 migration finds the owner of a cached visit.
String? repIdOf(String payload) => payloadText(payload, 'rep_id');

/// Whether a queued payload is [repId]'s to send: theirs, or nobody's.
bool isWorkOf(String payload, String? repId) {
  final owner = repIdOf(payload);
  return owner == null || owner == repId;
}

/// The text at [key] in a queued payload, or null when it is missing, not
/// text, or the payload is not JSON.
String? payloadText(String payload, String key) {
  try {
    final decoded = jsonDecode(payload);
    if (decoded is Map && decoded[key] is String) return decoded[key] as String;
  } on FormatException {
    // A payload that is not JSON is the replay's problem, not this check's.
  }
  return null;
}
