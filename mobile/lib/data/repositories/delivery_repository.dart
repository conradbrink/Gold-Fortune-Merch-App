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
  /// names come only on the delivery screen, from `delivery_contents()` (see
  /// [delivery]).
  ///
  /// `drivers` and `vehicles` are **not** embedded either, and that is a fact
  /// about the database rather than a choice about the screen: both are gated
  /// on `has_permission('warehouse')`, which a rep does not hold, so the embed
  /// would have come back null on every row and quietly rendered nothing. A
  /// courier's name typed into `carrier_name` lives on the dispatch itself and
  /// does show. Widening two more tables for a driver's name is a policy
  /// decision, not something to smuggle in through a select string.
  static const _select = '''
id, dispatch_number, status, dispatched_at, expected_delivery_on, delivered_at,
carrier_name, tracking_reference,
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

  /// No `dispatch_lines` embed: the products and their counts come from
  /// `delivery_contents()`, one row per order line.
  static const _detailSelect = '''
id, dispatch_number, status, dispatched_at, expected_delivery_on, delivered_at,
carrier_name, tracking_reference, notes, failure_reason, received_by_name,
order:orders(order_number, customer_po_number, customer_po_expires_on,
  contact_name, contact_phone, delivery_address, notes,
  store:stores(name, address, city, state, zip, lat, lng))
''';

  /// One delivery with what is in it, or null when it is not this rep's
  /// (any more): reassigned, or a link from somebody else's phone.
  ///
  /// The dispatch, its order and the place come through RLS as the list does;
  /// the products from `delivery_contents()`, which leaves the prices out
  /// (its migration says why). The two are asked at once — each needs only
  /// the id — and the products' failure is caught on its own: a delivery whose
  /// address and phone number came back is worth showing without them.
  Future<DeliveryDetail?> delivery(String dispatchId) async {
    final lines = _client
        .rpc('delivery_contents', params: {'p_dispatch': dispatchId})
        .then<List<dynamic>?>(
          (rows) => rows as List,
          onError: (Object _) => null,
        );
    final row = await _client
        .from('dispatches')
        .select(_detailSelect)
        .eq('id', dispatchId)
        .maybeSingle();
    if (row == null) return null;
    return DeliveryDetail.fromMaps(row, await lines);
  }

  /// How many are still on the road.
  ///
  /// Its own query, and not `myDeliveries().where(...)`. That list is the fifty
  /// newest dispatches whatever their status, so a rep with fifty finished
  /// deliveries and one outstanding would have been badged zero — the one case
  /// the badge exists for. A head count with the status in the filter cannot
  /// be wrong that way, and it rides the partial index.
  Future<int> outstandingCount() {
    // `.count()` straight off the filtered builder is a head request — the
    // number and no rows. `select('id').count()` transfers every matching id
    // to produce one integer, over a connection this app treats as expensive
    // everywhere else.
    // `count()` returns a filter builder, so the filter chains *after* it —
    // the reverse of a select. The request is head-only: the number and no
    // rows, over a connection this app treats as expensive everywhere else.
    return _client
        .from('dispatches')
        .count(CountOption.exact)
        .eq('status', 'in_transit');
  }
}
