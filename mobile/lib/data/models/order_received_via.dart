/// How an order reached the rep (`orders.received_via`).
///
/// An order taken standing in the shop is [orderTakenInShop], and is signed
/// for there. One the customer sent instead — by WhatsApp, a call, an email —
/// is a "New order" (owner, 29 Oct 2026): no visit, no check-in and no
/// signature, and the rep says how it came, from [orderSentChoices].
library;

/// `rep_visit`: taken in the shop, on a checked-in visit.
const orderTakenInShop = 'rep_visit';

/// What a rep can say a sent order came by, in the order the screen offers
/// them, with the words the rep reads. Every value is one
/// `orders_received_via_check` allows. No `in_person`: a shopkeeper who hands
/// the rep an order face to face is a visit, and goes through the check-in.
const orderSentChoices = <({String value, String label})>[
  (value: 'whatsapp', label: 'WhatsApp'),
  (value: 'phone', label: 'Phone call'),
  (value: 'email', label: 'Email'),
  (value: 'other', label: 'Other'),
];

/// Whether [value] is one of [orderSentChoices].
bool isOrderSentChoice(String? value) =>
    orderSentChoices.any((c) => c.value == value);
