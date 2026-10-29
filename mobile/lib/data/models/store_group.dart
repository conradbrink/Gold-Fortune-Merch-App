/// A price group (`store_groups`): the price list a customer's orders are
/// priced from. Offered when a rep adds a customer on the phone, and cached
/// so it can be offered with no signal.
class StoreGroup {
  final String id;
  final String name;

  const StoreGroup({required this.id, required this.name});

  Map<String, dynamic> toMap() => {'id': id, 'name': name};

  factory StoreGroup.fromMap(Map<String, dynamic> map) =>
      StoreGroup(id: map['id'] as String, name: map['name'] as String);
}

/// Who to ask for at a customer, as this phone last heard it. `stores` has no
/// contact columns; the order carries the contact, so the phone remembers the
/// last one per customer to fill the next order in.
class StoreContact {
  final String? name;
  final String? phone;

  const StoreContact({this.name, this.phone});

  Map<String, dynamic> toMap() => {'name': name, 'phone': phone};

  factory StoreContact.fromMap(Map<String, dynamic> map) => StoreContact(
        name: map['name'] as String?,
        phone: map['phone'] as String?,
      );
}
