/// A promotion the rep may be asked about, with the lines it covers.
///
/// Read-only reference data: the phone never edits one, it only answers about
/// them.
class Promotion {
  final String id;
  final String name;
  final String? brief;

  /// Inclusive `yyyy-MM-dd`, compared as strings against the phone's local
  /// date. Never parsed to a DateTime and never converted to UTC — in Botswana
  /// that shifts the boundary by two hours and a promotion would appear a day
  /// early or vanish a day late.
  final String startsOn;
  final String endsOn;

  /// Store ids this promotion covers.
  final List<String> storeIds;
  final List<PromotedProduct> products;

  const Promotion({
    required this.id,
    required this.name,
    this.brief,
    required this.startsOn,
    required this.endsOn,
    required this.storeIds,
    required this.products,
  });

  bool coversStore(String storeId) => storeIds.contains(storeId);

  /// [today] is `yyyy-MM-dd` in the rep's own timezone.
  bool coversDate(String today) => startsOn.compareTo(today) <= 0 && today.compareTo(endsOn) <= 0;

  Map<String, dynamic> toMap() => {
        'id': id,
        'name': name,
        'brief': brief,
        'starts_on': startsOn,
        'ends_on': endsOn,
        'promotion_stores': storeIds.map((s) => {'store_id': s}).toList(),
        'promotion_products':
            products.map((p) => {'products': p.toMap()}).toList(),
      };

  factory Promotion.fromMap(Map<String, dynamic> map) {
    final stores = (map['promotion_stores'] as List?) ?? const [];
    final prods = (map['promotion_products'] as List?) ?? const [];
    return Promotion(
      id: map['id'] as String,
      name: map['name'] as String,
      brief: map['brief'] as String?,
      startsOn: map['starts_on'] as String,
      endsOn: map['ends_on'] as String,
      storeIds: stores
          .map((s) => (s as Map<String, dynamic>)['store_id'] as String)
          .toList(),
      products: prods
          .map((p) => (p as Map<String, dynamic>)['products'])
          .whereType<Map<String, dynamic>>()
          .map(PromotedProduct.fromMap)
          .toList(),
    );
  }
}

class PromotedProduct {
  final String id;
  final String name;
  final String? brand;

  const PromotedProduct({required this.id, required this.name, this.brand});

  Map<String, dynamic> toMap() => {'id': id, 'name': name, 'brand': brand};

  factory PromotedProduct.fromMap(Map<String, dynamic> map) => PromotedProduct(
        id: map['id'] as String,
        name: map['name'] as String,
        brand: map['brand'] as String?,
      );
}

/// The three answers. `notStocked` is not a softer "no" — it says the shop has
/// never carried the line, which is a question for a buyer rather than a
/// failure by anyone in the shop.
class CheckStatus {
  static const running = 'running';
  static const notRunning = 'not_running';
  static const notStocked = 'not_stocked';
}
