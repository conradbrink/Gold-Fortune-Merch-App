/// A product a rep can put on an order.
///
/// Separate from `PromotedProduct`, which carries only what a promotion check
/// needs. This one carries the price and the pack size, because a rep taking an
/// order is quoting a figure to a shopkeeper.
class CatalogueProduct {
  const CatalogueProduct({
    required this.id,
    required this.name,
    this.brand,
    this.skuCode,
    this.unitsPerShrink,
    this.priceExclVat,
  });

  final String id;
  final String name;
  final String? brand;
  final String? skuCode;
  final int? unitsPerShrink;

  /// Trade price per shrink, excluding VAT — not a shelf price. The catalogue
  /// is explicit about this and the order screen says so too, because quoting
  /// a shelf price to a shopkeeper would be an expensive mistake.
  final double? priceExclVat;

  factory CatalogueProduct.fromMap(Map<String, dynamic> m) => CatalogueProduct(
        id: m['id'] as String,
        name: m['name'] as String,
        brand: m['brand'] as String?,
        skuCode: m['sku_code'] as String?,
        unitsPerShrink: (m['units_per_shrink'] as num?)?.toInt(),
        priceExclVat: (m['shrink_price_excl_vat'] as num?)?.toDouble(),
      );

  Map<String, dynamic> toMap() => {
        'id': id,
        'name': name,
        'brand': brand,
        'sku_code': skuCode,
        'units_per_shrink': unitsPerShrink,
        'shrink_price_excl_vat': priceExclVat,
      };

  /// What the rep types into to find a line, lowercased once at build time.
  String get searchText =>
      '$name ${brand ?? ''} ${skuCode ?? ''}'.toLowerCase();
}
