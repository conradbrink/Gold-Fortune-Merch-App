/// When a store last ordered and when it is due to order again, from
/// `store_reorder()`.
///
/// The server sends dates, not a verdict. This list is fetched with the day and
/// kept on the phone, and a rep may read it a day or two later with no signal:
/// "due" worked out on the server yesterday is wrong after midnight, so the
/// phone decides it against its own today ([reorderStateOn]).
///
/// The last order is whichever came last of a Tickd order (taken by anyone,
/// not only this rep) and an invoice brought over from QuickBooks.
class StoreReorder {
  final String storeId;

  /// The day of the last order, company time. Null when the store has never
  /// ordered.
  final DateTime? lastOrderOn;

  /// The order number ("SO-000150"), or the QuickBooks invoice number ("1790")
  /// when the last order is from before Tickd.
  final String? lastOrderRef;

  /// The order's status, or `invoiced` for a QuickBooks invoice.
  final String? lastOrderStatus;

  /// Days with an order in the last year.
  final int orderDaysYear;

  /// The store's usual days between orders, or null with fewer than three
  /// order days in the last year.
  final int? usualDays;

  /// How long after its last order the store is due: its usual gap or the
  /// company's rule (30 days unless changed), whichever is sooner.
  final int dueAfterDays;

  const StoreReorder({
    required this.storeId,
    this.lastOrderOn,
    this.lastOrderRef,
    this.lastOrderStatus,
    this.orderDaysYear = 0,
    this.usualDays,
    required this.dueAfterDays,
  });

  bool get isFromQuickBooks => lastOrderStatus == 'invoiced';

  /// True while the last order is still on its way to the store.
  bool get lastOrderOpen => const {
        'new',
        'confirmed',
        'picking',
        'packed',
        'dispatched',
      }.contains(lastOrderStatus);

  factory StoreReorder.fromMap(Map<String, dynamic> map) {
    final last = map['last_order_on'] as String?;
    return StoreReorder(
      storeId: map['store_id'] as String,
      lastOrderOn: last == null ? null : _day(DateTime.parse(last)),
      lastOrderRef: map['last_order_ref'] as String?,
      lastOrderStatus: map['last_order_status'] as String?,
      orderDaysYear: (map['order_days_year'] as num?)?.toInt() ?? 0,
      usualDays: (map['usual_days'] as num?)?.toInt(),
      dueAfterDays: (map['due_after_days'] as num?)?.toInt() ?? 30,
    );
  }

  /// The same shape [fromMap] reads, so the cache stores rows verbatim.
  Map<String, dynamic> toMap() => {
        'store_id': storeId,
        'last_order_on': lastOrderOn == null ? null : _dateOnly(lastOrderOn!),
        'last_order_ref': lastOrderRef,
        'last_order_status': lastOrderStatus,
        'order_days_year': orderDaysYear,
        'usual_days': usualDays,
        'due_after_days': dueAfterDays,
      };
}

/// Where a store stands on ordering today.
enum ReorderState {
  /// No order on record at all.
  never,

  /// Ordered recently; not due for more than a week.
  notDue,

  /// Due within the next seven days.
  dueSoon,

  /// Due: it has gone its usual time (or the company's rule) without an order.
  due,

  /// Nothing for twice the time it is due after. The same "stopped ordering"
  /// the dashboard uses, measured against this store's own rhythm.
  stopped,
}

/// A store's state on [today], and the day counts the screen needs.
class ReorderStatus {
  const ReorderStatus(this.state, {this.daysSince, this.daysUntilDue});

  final ReorderState state;

  /// Days since the last order; null when it never ordered.
  final int? daysSince;

  /// Days until it is due: negative once overdue, null when it never ordered.
  final int? daysUntilDue;

  /// True when the screen should ask the rep to take an order.
  bool get asksForOrder =>
      state == ReorderState.never ||
      state == ReorderState.due ||
      state == ReorderState.stopped;
}

/// The window before a store is due in which the phone already mentions it.
const dueSoonDays = 7;

/// Decides where [r] stands on [today]. Mirrors `reorderState` in
/// web/lib/store-reorder.ts, so the phone and the dashboard agree.
ReorderStatus reorderStateOn(StoreReorder r, DateTime today) {
  final last = r.lastOrderOn;
  if (last == null) return const ReorderStatus(ReorderState.never);
  final since = _day(today).difference(_day(last)).inDays;
  final until = r.dueAfterDays - since;
  final state = since >= 2 * r.dueAfterDays
      ? ReorderState.stopped
      : until <= 0
          ? ReorderState.due
          : until <= dueSoonDays
              ? ReorderState.dueSoon
              : ReorderState.notDue;
  return ReorderStatus(state, daysSince: since, daysUntilDue: until);
}

/// "today", "yesterday", "26 days ago".
String daysAgo(int days) => switch (days) {
      <= 0 => 'today',
      1 => 'yesterday',
      _ => '$days days ago',
    };

/// How often a store orders, said the way a person would: "every 10 days",
/// "every 3 weeks", "once a month", "every 2 months".
String orderRhythm(int usualDays) {
  if (usualDays < 11) return usualDays == 1 ? 'every day' : 'every $usualDays days';
  if (usualDays < 50) {
    final weeks = (usualDays / 7).round();
    return 'every $weeks weeks';
  }
  final months = (usualDays / 30.4).round();
  return months <= 1 ? 'once a month' : 'every $months months';
}

/// The last order's status in a few words, or null when there is nothing worth
/// saying (delivered, or a QuickBooks invoice).
String? lastOrderProgress(StoreReorder r) => switch (r.lastOrderStatus) {
      'new' => 'not confirmed yet',
      'confirmed' || 'picking' => 'being packed',
      'packed' => 'packed, not sent yet',
      'dispatched' => 'on its way',
      _ => null,
    };

DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

String _dateOnly(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';
