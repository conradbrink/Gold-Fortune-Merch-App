import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../local/app_database.dart';
import '../local/order_draft.dart';
import '../local/outbox_types.dart';
import '../models/catalogue_product.dart';
import '../models/store_reorder.dart';
import '../sync/sync_engine.dart';

const _uuid = Uuid();

/// Trimmed, null when empty, and at most [max] Unicode code points: the
/// database's `length()` counts code points, while a phone's text field counts
/// what the eye sees, and one emoji can be several. A note the database would
/// refuse would sit in the outbox for good, so it is cut here instead.
String? clipText(String? text, int max) {
  final t = text?.trim();
  if (t == null || t.isEmpty) return null;
  final runes = t.runes;
  return runes.length <= max ? t : String.fromCharCodes(runes.take(max)).trimRight();
}

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
  static const _reorderKey = 'store_reorder';
  static const _takenKey = 'orders_taken_on_visits';
  static const _declinedKey = 'order_declines_on_visits';
  static const _damagesKey = 'damages_on_visits';

  /// An unfinished damage report, one per visit, kept by its screen.
  static const _damageDraftPrefix = 'damage_draft:';
  static String damageDraftKey(String visitClientGeneratedId) => '$_damageDraftPrefix$visitClientGeneratedId';

  /// How long an unfinished damage report is kept before it is dropped.
  static const damageDraftMaxAge = Duration(days: 7);

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
    String? contactName,
    String? contactPhone,
    String? requiredBy,
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
      'contact_name': contactName,
      'contact_phone': contactPhone,
      'required_by': requiredBy,
      'visit_client_generated_id': visitClientGeneratedId,
      // Converted out of the rep's shrinks and into the base units the
      // warehouse reserves in. This is the only place the two denominations
      // meet: everything above it is what the rep typed, everything below is
      // what `order_confirm` will draw out of `stock_balances`.
      //
      // `unit_price` is sent as null on purpose. The database prices each
      // line as it arrives, from the store's group price list or else the
      // product's own price (`order_lines_price_from_list`, 20261015210000),
      // so the phone never quotes a figure the invoice then contradicts.
      'lines': lines
          .map((l) => {
                'product_id': l.productId,
                'qty_ordered': l.qtyOrderedBaseUnits,
                'unit_price': null,
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
      await _rememberOrderTaken(visitClientGeneratedId);
    });

    unawaited(_sync.sync());
    return clientId;
  }

  /// When every store last ordered and when it is due again, keyed by store.
  ///
  /// The whole company's list in one call (a few hundred short rows), fetched
  /// with the day and kept, for the same reason as the catalogue: the rep reads
  /// it at a shop door, often with no signal. Empty when it has never been
  /// read, and the screens then simply say nothing about it.
  Future<Map<String, StoreReorder>> fetchReorder() async {
    try {
      final rows = await _client.rpc('store_reorder');
      final list = (rows as List)
          .map((r) => StoreReorder.fromMap(r as Map<String, dynamic>))
          .toList();
      await _db.setValue(
        _reorderKey,
        jsonEncode(list.map((r) => r.toMap()).toList()),
      );
      return {for (final r in list) r.storeId: r};
    } catch (_) {
      return cachedReorder();
    }
  }

  Future<Map<String, StoreReorder>> cachedReorder() async {
    final raw = await _db.getValue(_reorderKey);
    if (raw == null || raw.isEmpty) return const {};
    try {
      return {
        for (final r in jsonDecode(raw) as List)
          (r as Map)['store_id'] as String:
              StoreReorder.fromMap(Map<String, dynamic>.from(r)),
      };
    } catch (_) {
      return const {};
    }
  }

  /// Whether an order was taken on this visit, from the phone's own record.
  ///
  /// The server's list cannot say so until the order has synced and the list
  /// been fetched again, and a rep with no signal would otherwise be asked for
  /// an order they have just taken.
  Future<bool> orderTakenOnVisit(String visitClientGeneratedId) async {
    return (await _visitRecord(_takenKey)).containsKey(visitClientGeneratedId);
  }

  /// Every visit an order was taken on, from the phone's own record: what the
  /// day's list reads once, rather than once per stop.
  Future<Set<String>> visitsWithOrderTaken() async {
    return (await _visitRecord(_takenKey)).keys.toSet();
  }

  Future<void> _rememberOrderTaken(String visitClientGeneratedId) =>
      _rememberVisit(_takenKey, visitClientGeneratedId, (_) => null);

  /// A small per-visit record kept under [key]: visit id → `{at, value}`.
  ///
  /// One shape for every such record (orders taken, reasons, damages). A bare
  /// string is what 1.2.1 wrote for an order taken (just the time), and is
  /// read as that. Anything else that does not parse is dropped rather than
  /// thrown: a record that cannot be read must never stop the next one being
  /// written.
  Future<Map<String, ({DateTime at, Object? value})>> _visitRecord(String key) async {
    final raw = await _db.getValue(key);
    if (raw == null || raw.isEmpty) return {};
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } catch (_) {
      return {};
    }
    if (decoded is! Map) return {};
    final out = <String, ({DateTime at, Object? value})>{};
    decoded.forEach((k, v) {
      final at = DateTime.tryParse(v is Map ? '${v['at']}' : '$v');
      if (k is String && at != null) out[k] = (at: at, value: v is Map ? v['value'] : null);
    });
    return out;
  }

  /// Records the visit (its new value worked out from the old one), and
  /// forgets visits older than three days: the record only has to outlive the
  /// visit.
  Future<void> _rememberVisit(
    String key,
    String visitClientGeneratedId,
    Object? Function(Object? previous) value,
  ) async {
    final now = DateTime.now();
    final cutoff = now.subtract(const Duration(days: 3));
    final record = await _visitRecord(key);
    record.removeWhere((_, v) => v.at.isBefore(cutoff));
    final previous = record[visitClientGeneratedId]?.value;
    record[visitClientGeneratedId] = (at: now, value: value(previous));
    await _db.setValue(
      key,
      jsonEncode({
        for (final e in record.entries)
          e.key: {'at': e.value.at.toIso8601String(), 'value': e.value.value},
      }),
    );
  }

  /// Records why the store did not order on this visit, queued for sync.
  ///
  /// Remembered on the phone as well, by visit, so the store screen stops
  /// asking at once and with no signal; the queue and the record are written
  /// together, for the reason `submitOrder` gives.
  Future<void> recordDecline({
    required String orgId,
    required String repId,
    required String storeId,
    required String visitClientGeneratedId,
    required String reason,
    String? note,
  }) async {
    final clientId = _uuid.v4();
    final payload = <String, dynamic>{
      'org_id': orgId,
      'rep_id': repId,
      'store_id': storeId,
      'visit_client_generated_id': visitClientGeneratedId,
      'client_generated_id': clientId,
      'reason': reason,
      'note': clipText(note, 500),
      'created_at': DateTime.now().toUtc().toIso8601String(),
    };
    await _db.transaction(() async {
      await _db.enqueue(
        entityType: OutboxType.orderDecline,
        clientGeneratedId: clientId,
        payload: jsonEncode(payload),
      );
      await _rememberVisit(_declinedKey, visitClientGeneratedId, (_) => reason);
    });
    unawaited(_sync.sync());
  }

  /// The reason given on this visit, from the phone's own record, or null.
  Future<String?> declineOnVisit(String visitClientGeneratedId) async {
    final value = (await _visitRecord(_declinedKey))[visitClientGeneratedId]?.value;
    return value is String ? value : null;
  }

  /// Records damaged stock found at the store, queued for sync with its photo.
  ///
  /// [photo] is a file already copied somewhere durable
  /// (`FormRepository.persistCapturedPhoto`), with the id it was saved under.
  /// It is uploaded to `damage-photos` when the report syncs. What was
  /// reported is remembered on the phone as well, by visit, so the store
  /// screen can list it straight away and with no signal.
  Future<void> reportDamage({
    required String orgId,
    required String repId,
    required String storeId,
    required String visitClientGeneratedId,
    String? productId,
    String? item,
    required String label,
    required int qty,
    String? problem,
    ({File file, String clientId})? photo,
  }) async {
    final what = productId == null ? clipText(item, 200) : null;
    if (productId == null && what == null) {
      throw ArgumentError('Say what is damaged.');
    }
    final clientId = _uuid.v4();
    final now = DateTime.now().toUtc().toIso8601String();
    final payload = <String, dynamic>{
      'org_id': orgId,
      'rep_id': repId,
      'store_id': storeId,
      'visit_client_generated_id': visitClientGeneratedId,
      'client_generated_id': clientId,
      'product_id': productId,
      'item': what,
      'qty': qty,
      'problem': clipText(problem, 500),
      'created_at': now,
      if (photo != null) 'local_photo_path': photo.file.path,
    };
    await _db.transaction(() async {
      await _db.enqueue(
        entityType: OutboxType.damageReport,
        clientGeneratedId: clientId,
        payload: jsonEncode(payload),
      );
      await _rememberVisit(
        _damagesKey,
        visitClientGeneratedId,
        (previous) => [
          if (previous is List) ...previous,
          {'name': label, 'qty': qty},
        ],
      );
      // The draft goes with the same write: one left behind would bring the
      // report back, and "Start again" would then delete the photo the queued
      // report still needs.
      await _db.deleteValue(damageDraftKey(visitClientGeneratedId));
    });
    unawaited(_sync.sync());
  }

  /// Drops unfinished damage reports nobody can come back to, each with its
  /// photo: [visit]'s, once it is checked out (the box is only on a visit in
  /// progress), and any older than [damageDraftMaxAge]. A queued report never
  /// shares a photo with a draft: [reportDamage] clears the draft as it queues.
  Future<void> dropDamageDrafts({String? visit, DateTime? now}) async {
    final cutoff = (now ?? DateTime.now()).subtract(damageDraftMaxAge);
    final drafts = await _db.valuesWithPrefix(_damageDraftPrefix);
    for (final MapEntry(:key, :value) in drafts.entries) {
      Object? draft;
      try {
        draft = jsonDecode(value);
      } catch (_) {
        // Unreadable: dropped below.
      }
      final saved = draft is Map ? DateTime.tryParse('${draft['saved_at']}') : null;
      final ended = visit != null && key == damageDraftKey(visit);
      if (!ended && saved != null && saved.isAfter(cutoff)) continue;
      await _db.deleteValue(key);
      final photo = draft is Map ? draft['photo_path'] : null;
      if (photo is String) {
        try {
          await File(photo).delete();
        } catch (_) {
          // A leftover file costs space, not a report.
        }
      }
    }
  }

  /// What was reported damaged on this visit, from the phone's own record.
  Future<List<({String name, int qty})>> damagesOnVisit(String visitClientGeneratedId) async {
    final value = (await _visitRecord(_damagesKey))[visitClientGeneratedId]?.value;
    if (value is! List) return const [];
    return [
      for (final i in value)
        if (i is Map) (name: '${i['name']}', qty: (i['qty'] as num?)?.toInt() ?? 1),
    ];
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
