// A consignment somebody has made this rep responsible for.
//
// Read on the phone, with one action: the rep it is assigned to records a
// full drop with a photo of the signed delivery note, through
// `delivery_confirm()` (20261027201700), which moves the stock out of transit
// and files the photo as the order's POD in one transaction. A short drop is
// still the warehouse's to record.

import 'package:intl/intl.dart';

/// Trimmed text, or null when there is none: typed fields arrive as '' or
/// '  ' as often as null, and a blank one must not draw an empty row.
String? _text(Object? v) {
  final s = (v as String?)?.trim();
  return s == null || s.isEmpty ? null : s;
}

/// A Postgres timestamptz, on this phone's clock. Converted here so no screen
/// can forget: late in the evening the UTC date is already tomorrow's.
DateTime? _local(Object? v) =>
    v == null ? null : DateTime.parse(v as String).toLocal();

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

  /// Local time.
  final DateTime dispatchedAt;

  /// A date, at local midnight.
  final DateTime? expectedOn;

  /// Local time.
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
      storeName: _text(store?['name']) ?? 'Unknown location',
      storeAddress: _text(store?['address']),
      orderNumber: (order?['order_number'] as String?) ?? '',
      dispatchedAt: _local(m['dispatched_at'])!,
      // A date, not an instant: parsed as local midnight already.
      expectedOn: m['expected_delivery_on'] == null
          ? null
          : DateTime.parse(m['expected_delivery_on'] as String),
      deliveredAt: _local(m['delivered_at']),
      carrier: _text(m['carrier_name']),
      trackingReference: _text(m['tracking_reference']),
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

/// One product on a delivery, as `delivery_contents()` returns it: the
/// product and the quantities, never the price (its migration says why).
class DeliveryLine {
  const DeliveryLine({
    required this.productName,
    required this.brand,
    required this.skuCode,
    required this.unitsPerShrink,
    required this.qty,
    required this.qtyOrdered,
    required this.qtyDelivered,
    required this.qtyReturned,
  });

  final String productName;
  final String? brand;
  final String? skuCode;
  final int? unitsPerShrink;

  /// Units in this delivery.
  final int qty;

  /// Units the order asked for. More than [qty] when the warehouse sent less,
  /// or sends the rest on another delivery.
  final int? qtyOrdered;
  final int qtyDelivered;
  final int qtyReturned;

  /// How many units of the order are not in this delivery.
  int get shortBy {
    final ordered = qtyOrdered;
    return ordered != null && ordered > qty ? ordered - qty : 0;
  }

  /// "2 shrinks", when the units make whole shrinks; null otherwise. The
  /// phone takes orders in shrinks and the warehouse ships units, so a rep
  /// checking a box against what was asked for needs both.
  String? get inShrinks {
    final per = unitsPerShrink ?? 0;
    if (per <= 1 || qty <= 0 || qty % per != 0) return null;
    final n = qty ~/ per;
    return '$n ${n == 1 ? 'shrink' : 'shrinks'}';
  }

  factory DeliveryLine.fromMap(Map<String, dynamic> m) => DeliveryLine(
    productName: m['product_name'] as String,
    brand: _text(m['brand']),
    skuCode: _text(m['sku_code']),
    unitsPerShrink: (m['units_per_shrink'] as num?)?.toInt(),
    qty: (m['qty'] as num?)?.toInt() ?? 0,
    qtyOrdered: (m['qty_ordered'] as num?)?.toInt(),
    qtyDelivered: (m['qty_delivered'] as num?)?.toInt() ?? 0,
    qtyReturned: (m['qty_returned'] as num?)?.toInt() ?? 0,
  );
}

/// How close the buyer's purchase order is to running out.
enum PoUrgency { calm, soon, lapsed }

/// Everything the delivery screen shows: the list's summary, where it is
/// going and who to ask for, and what is in it.
class DeliveryDetail {
  const DeliveryDetail({
    required this.delivery,
    required this.placeName,
    required this.city,
    required this.state,
    required this.zip,
    required this.lat,
    required this.lng,
    required this.deliveryAddress,
    required this.contactName,
    required this.contactPhone,
    required this.poNumber,
    required this.poExpiresOn,
    required this.orderNotes,
    required this.dispatchNotes,
    required this.failureReason,
    required this.receivedBy,
    required this.lines,
    this.orderId,
  });

  /// Its counts are this delivery's products, from [lines].
  final Delivery delivery;

  /// The place's own name, when it has one; [Delivery.storeName] falls back
  /// to a placeholder, which must never be searched for on a map.
  final String? placeName;
  final String? city;
  final String? state;
  final String? zip;
  final double? lat;
  final double? lng;

  /// Typed on the order when the drop is not at the usual address.
  final String? deliveryAddress;
  final String? contactName;
  final String? contactPhone;

  /// The buyer's own purchase order number, which is what a receiving clerk
  /// looks the delivery up by, and the day it lapses.
  final String? poNumber;
  final DateTime? poExpiresOn;
  final String? orderNotes;
  final String? dispatchNotes;
  final String? failureReason;
  final String? receivedBy;

  /// The order behind the dispatch: its POD photo is filed under it.
  final String? orderId;

  /// Null when the products could not be loaded: the rest of the delivery
  /// still is, and is still worth showing.
  final List<DeliveryLine>? lines;

  /// Where it is going, as the other screens write a place: street, town,
  /// region. The order's own delivery address wins: it is there because the
  /// usual one is wrong for this drop.
  String? get address {
    if (deliveryAddress != null) return deliveryAddress;
    final parts = [delivery.storeAddress, city, state].whereType<String>();
    return parts.isEmpty ? null : parts.join(', ');
  }

  /// Google Maps directions, which opens the Maps app on a phone that has it.
  ///
  /// The place is found as the web finds it (web/lib/maps.ts, `mapsQuery`):
  /// its pin when it has one; otherwise its address, led by its name when the
  /// company finds its places by name ([byName]: Distribution is on, which it
  /// always is where there are deliveries) or when there is no street to go
  /// by. An address typed on the order comes first of all: the pin and the
  /// usual address are the place's, and this drop is going somewhere else.
  Uri? directions({bool byName = true}) {
    final String destination;
    if (deliveryAddress != null) {
      destination = deliveryAddress!;
    } else if (lat != null && lng != null) {
      destination = '$lat,$lng';
    } else {
      final where = [
        delivery.storeAddress,
        city,
        state,
        zip,
      ].whereType<String>();
      final parts = byName || delivery.storeAddress == null
          ? [?placeName, ...where]
          : where.toList();
      if (parts.isEmpty) return null;
      destination = parts.join(', ');
    }
    return Uri.https('www.google.com', '/maps/dir/', {
      'api': '1',
      'destination': destination,
    });
  }

  /// The number to dial, or null when what was typed has none.
  ///
  /// The contact's phone is free text: "(+267) 71 234 567", "71 234 567 /
  /// 72 345 678", "082 123 4567 ext 12", "n/a". This takes the first number,
  /// drops a "(0)" trunk digit written after a country code, keeps a leading
  /// +, and refuses anything too short to be a phone number.
  Uri? get dial {
    final typed = contactPhone;
    if (typed == null) return null;
    final first = typed
        .split(RegExp(r'[/,;]|\b(?:or|ext|x)\b', caseSensitive: false))
        .first
        .replaceAll('(0)', '');
    final digits = first.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 7) return null;
    final plus = RegExp(r'^[^0-9+]*\+').hasMatch(first);
    return Uri(scheme: 'tel', path: '${plus ? '+' : ''}$digits');
  }

  /// The purchase order's expiry, in the web order board's words
  /// (web/lib/order-board.ts, `poExpiry`): lapsed, in its last two days, or
  /// still good. Null when the order has no expiry.
  ({PoUrgency urgency, String words})? poExpiry(DateTime today) {
    final e = poExpiresOn;
    if (e == null) return null;
    // Whole days between two calendar dates, counted in UTC so a daylight
    // saving change in between cannot make one of them 23 hours long.
    final expires = DateTime.utc(e.year, e.month, e.day);
    final now = DateTime.utc(today.year, today.month, today.day);
    final left = expires.difference(now).inDays;
    final day = DateFormat('d MMM').format(e);
    return switch (left) {
      < 0 => (urgency: PoUrgency.lapsed, words: 'PO expired on $day'),
      0 => (urgency: PoUrgency.soon, words: 'PO expires today'),
      1 => (urgency: PoUrgency.soon, words: 'PO expires tomorrow'),
      2 => (urgency: PoUrgency.soon, words: 'PO expires in 2 days, on $day'),
      _ => (urgency: PoUrgency.calm, words: 'PO valid until $day'),
    };
  }

  /// [lines] is what `delivery_contents()` returned, or null when that call
  /// failed. The delivery's counts are taken from it, one row per product.
  factory DeliveryDetail.fromMaps(
    Map<String, dynamic> dispatch,
    List<dynamic>? lines,
  ) {
    final order = dispatch['order'] as Map<String, dynamic>?;
    final store = order?['store'] as Map<String, dynamic>?;

    return DeliveryDetail(
      delivery: Delivery.fromMap({...dispatch, 'lines': lines ?? const []}),
      placeName: _text(store?['name']),
      city: _text(store?['city']),
      state: _text(store?['state']),
      zip: _text(store?['zip']),
      lat: (store?['lat'] as num?)?.toDouble(),
      lng: (store?['lng'] as num?)?.toDouble(),
      deliveryAddress: _text(order?['delivery_address']),
      contactName: _text(order?['contact_name']),
      contactPhone: _text(order?['contact_phone']),
      poNumber: _text(order?['customer_po_number']),
      poExpiresOn: order?['customer_po_expires_on'] == null
          ? null
          : DateTime.parse(order!['customer_po_expires_on'] as String),
      orderNotes: _text(order?['notes']),
      dispatchNotes: _text(dispatch['notes']),
      failureReason: _text(dispatch['failure_reason']),
      receivedBy: _text(dispatch['received_by_name']),
      orderId: dispatch['order_id'] as String?,
      lines: lines == null
          ? null
          : [
              for (final l in lines)
                DeliveryLine.fromMap(l as Map<String, dynamic>),
            ],
    );
  }
}
