// A place's address as an order writes it, and how a typed delivery address
// is told apart from it. The order screen fills the delivery address in with
// the place's own (owner, 29 Oct 2026), so most orders carry one that only
// repeats it; the driver's plan must still go by the place's pin for those
// (lib/features/driver/route_plan.dart, and web/lib/route-plan.ts for Google).

/// "12 Main Road, Mahikeng": the street and the town, without repeating a
/// town the address already names. Null when neither is on record.
String? deliveryAddressOf(String? address, String? city) {
  final street = address?.trim() ?? '';
  final town = city?.trim() ?? '';
  if (street.isEmpty) return town.isEmpty ? null : town;
  if (town.isEmpty || street.toLowerCase().contains(town.toLowerCase())) {
    return street;
  }
  return '$street, $town';
}

/// Whether [typed], an order's delivery address, is only the place's own
/// address: what the order screen fills in ([deliveryAddressOf]), the street
/// alone, or either with the region after it. Case, commas and spacing do not
/// count. Anything else was typed because this drop goes somewhere else.
bool isUsualAddress(
  String typed, {
  required String? address,
  required String? city,
  required String? state,
}) {
  final words = _plain(typed);
  if (words.isEmpty) return false;
  final usual = deliveryAddressOf(address, city);
  return {
    address,
    usual,
    if (usual != null && state != null) '$usual, $state',
    if (address != null && state != null) '$address, $state',
  }.whereType<String>().map(_plain).contains(words);
}

/// Letters and digits only, lower case, one space between words.
String _plain(String s) => s
    .toLowerCase()
    .replaceAll(RegExp(r'[^\p{L}\p{N}]+', unicode: true), ' ')
    .trim();
