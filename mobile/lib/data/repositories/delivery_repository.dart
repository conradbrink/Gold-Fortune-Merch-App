import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/delivery.dart';

/// Deliveries the warehouse has made this rep responsible for.
///
/// Nothing here filters by rep. `dispatches_select` does: a rep sees a dispatch
/// when `assigned_rep_id` is theirs and otherwise does not see it at all, so
/// this is a plain select and the answer is already narrowed. Adding
/// `.eq('assigned_rep_id', myId)` on top would look like the security and would
/// be the second-best copy of it.
///
/// Online only, like the HR screens and unlike the rest of the app. A stale
/// delivery list is worse than none: a rep looking at yesterday's cache in a
/// shop's back room, being told the stock is on its way when it was returned
/// this morning, is the exact failure this screen exists to prevent.
class DeliveryRepository {
  DeliveryRepository(this._client);

  final SupabaseClient _client;

  /// `dispatch_lines` is embedded for the count and the units. The product
  /// names are deliberately not: naming them means reading `order_lines`, whose
  /// policy is its own and which carries the pricing. A rep assigned somebody
  /// else's delivery has no business with what the shop is paying for it.
  static const _select = '''
id, dispatch_number, status, dispatched_at, expected_delivery_on, delivered_at,
carrier_name, tracking_reference,
driver:drivers(full_name),
vehicle:vehicles(registration),
order:orders(order_number, store:stores(name, address)),
lines:dispatch_lines(qty)
''';

  Future<List<Delivery>> myDeliveries() async {
    final rows = await _client
        .from('dispatches')
        .select(_select)
        // Outstanding first is the wrong sort here: a rep opens this to see
        // what is coming, and what is coming is the newest. The screen groups
        // by status instead, so the order within each group stays chronological.
        .order('dispatched_at', ascending: false)
        .limit(50);
    return [
      for (final r in rows as List) Delivery.fromMap(r as Map<String, dynamic>),
    ];
  }
}
