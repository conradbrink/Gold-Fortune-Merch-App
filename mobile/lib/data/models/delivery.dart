// A consignment somebody has made this rep responsible for.
//
// Read-only on the phone. Marking a delivery received moves stock out of the
// in-transit location and closes the order, which `order_mark_delivered()` does
// in one transaction with the proof of delivery beside it — that is a warehouse
// action with an audit trail, and a second path into it from a handset is not
// something to add casually.

class Delivery {
  const Delivery({
    required this.id,
    required this.dispatchNumber,
    required this.status,
    required this.storeName,
    required this.storeAddress,
    required this.orderNumber,
    required this.dispatchedAt,
    required this.expectedOn,
    required this.deliveredAt,
    required this.carrier,
    required this.trackingReference,
    required this.lineCount,
    required this.units,
  });

  final String id;
  final String dispatchNumber;

  /// `in_transit`, `delivered`, `failed`, `returned`.
  final String status;
  final String storeName;
  final String? storeAddress;
  final String orderNumber;
  final DateTime dispatchedAt;
  final DateTime? expectedOn;
  final DateTime? deliveredAt;

  /// The courier, where the warehouse named one. A driver or vehicle record is
  /// behind `has_permission('warehouse')` and a rep cannot read either, so this
  /// is the only carrier detail that reaches the phone.
  final String? carrier;
  final String? trackingReference;
  final int lineCount;
  final int units;

  bool get isOutstanding => status == 'in_transit';

  factory Delivery.fromMap(Map<String, dynamic> m) {
    final order = m['order'] as Map<String, dynamic>?;
    final store = order?['store'] as Map<String, dynamic>?;
    final lines = (m['lines'] as List?) ?? const [];

    return Delivery(
      id: m['id'] as String,
      dispatchNumber: (m['dispatch_number'] as String?) ?? '',
      status: (m['status'] as String?) ?? 'in_transit',
      storeName: (store?['name'] as String?) ?? 'Unknown store',
      storeAddress: store?['address'] as String?,
      orderNumber: (order?['order_number'] as String?) ?? '',
      dispatchedAt: DateTime.parse(m['dispatched_at'] as String),
      expectedOn: m['expected_delivery_on'] == null
          ? null
          : DateTime.parse(m['expected_delivery_on'] as String),
      deliveredAt: m['delivered_at'] == null
          ? null
          : DateTime.parse(m['delivered_at'] as String),
      carrier: m['carrier_name'] as String?,
      trackingReference: m['tracking_reference'] as String?,
      lineCount: lines.length,
      // Summed from the dispatch lines rather than the order's, because a
      // consignment is what actually left the building — a short-picked order
      // ships less than it asked for, and the rep is carrying the smaller
      // number.
      units: lines.fold<int>(
        0,
        (n, l) => n + ((l as Map<String, dynamic>)['qty'] as num? ?? 0).toInt(),
      ),
    );
  }
}
