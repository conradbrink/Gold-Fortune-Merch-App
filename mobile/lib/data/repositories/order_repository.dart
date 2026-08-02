import 'dart:async';
import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../local/app_database.dart';
import '../local/order_draft.dart';
import '../local/outbox_types.dart';
import '../models/catalogue_product.dart';
import '../sync/sync_engine.dart';

const _uuid = Uuid();

/// Orders a rep takes while standing in a shop.
///
/// ------------------------------------------------------------- stock
///
/// The rep is never shown available stock, and that is deliberate rather than
/// missing. `stock_balances` is readable by a rep only for their own van, so
/// the warehouse figure is not theirs to see — and it would be wrong by the
/// time they got back to signal anyway. The warehouse checks availability at
/// confirm time, under a row lock, which is the only place it can be checked
/// honestly. The rep writes down what the shop asked for.
class OrderRepository {
  OrderRepository(this._client, this._db, this._sync);

  final SupabaseClient _client;
  final AppDatabase _db;
  final SyncEngine _sync;

  static const _cacheKey = 'catalogue_products';

  late final drafts = OrderDraftStore(_db);

  /// The whole orderable catalogue, cached.
  ///
  /// Fetched once for the org and held, exactly as promotions and form
  /// templates are: a per-store fetch would put the rep back to needing signal
  /// at every door, which is the problem the depot warm-up exists to solve.
  /// Eighteen products is a couple of kilobytes.
  Future<List<CatalogueProduct>> fetchCatalogue() async {
    try {
      final rows = await _client
          .from('products')
          .select('id, name, brand, sku_code, units_per_shrink, shrink_price_excl_vat')
          .eq('active', true)
          .eq('is_stock_tracked', true)
          .order('name', ascending: true);

      final products = (rows as List)
          .map((r) => CatalogueProduct.fromMap(r as Map<String, dynamic>))
          .toList();

      await _db.setValue(
        _cacheKey,
        jsonEncode(products.map((p) => p.toMap()).toList()),
      );
      return products;
    } catch (_) {
      return cachedCatalogue();
    }
  }

  Future<List<CatalogueProduct>> cachedCatalogue() async {
    final raw = await _db.getValue(_cacheKey);
    if (raw == null || raw.isEmpty) return const [];
    try {
      return (jsonDecode(raw) as List)
          .map((r) => CatalogueProduct.fromMap(Map<String, dynamic>.from(r as Map)))
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Queues an order for sync and clears the draft.
  ///
  /// The enqueue and the draft clear happen in one transaction. Without it a
  /// crash between the two leaves either an order queued with its draft still
  /// on disk — which the rep would find and send twice — or a cleared draft
  /// with nothing queued, which is the order simply gone. `LeadRepository.start`
  /// carries the same note for the same reason.
  Future<String> submitOrder({
    required String orgId,
    required String repId,
    required String storeId,
    required String visitClientGeneratedId,
    required List<OrderDraftLine> lines,
    String? note,
  }) async {
    if (lines.isEmpty) {
      throw ArgumentError('An order needs at least one line.');
    }

    final clientId = _uuid.v4();
    final payload = <String, dynamic>{
      'org_id': orgId,
      'rep_id': repId,
      'store_id': storeId,
      'client_generated_id': clientId,
      'source': 'rep_app',
      'received_via': 'rep_visit',
      'notes': note,
      'visit_client_generated_id': visitClientGeneratedId,
      'lines': lines
          .map((l) => {
                'product_id': l.productId,
                'qty_ordered': l.qty,
                'unit_price': l.unitPrice,
                // Each line carries its own idempotency key, so a partially
                // applied insert can be completed rather than duplicated.
                'client_generated_id': _uuid.v4(),
              })
          .toList(),
    };

    await _db.transaction(() async {
      await _db.enqueue(
        entityType: OutboxType.orderCreate,
        clientGeneratedId: clientId,
        payload: jsonEncode(payload),
      );
      await drafts.clear(visitClientGeneratedId);
    });

    unawaited(_sync.sync());
    return clientId;
  }

  /// Orders this rep has taken at a store, newest first. Server-only: an order
  /// still in the outbox is shown by the screen from its own queue state.
  Future<List<Map<String, dynamic>>> ordersForStore(String storeId) async {
    try {
      final rows = await _client
          .from('orders')
          .select('id, order_number, status, created_at')
          .eq('store_id', storeId)
          .order('created_at', ascending: false)
          .limit(10);
      return (rows as List).cast<Map<String, dynamic>>();
    } catch (_) {
      return const [];
    }
  }
}
