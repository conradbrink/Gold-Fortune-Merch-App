import 'dart:convert';

import 'app_database.dart';

/// One line of an order still being typed.
class OrderDraftLine {
  const OrderDraftLine({
    required this.productId,
    required this.qty,
    this.unitPrice,
  });

  final String productId;
  final int qty;
  final double? unitPrice;

  Map<String, dynamic> toMap() => {
        'product_id': productId,
        'qty': qty,
        'unit_price': unitPrice,
      };

  static OrderDraftLine fromMap(Map<String, dynamic> m) => OrderDraftLine(
        productId: m['product_id'] as String,
        qty: (m['qty'] as num).toInt(),
        unitPrice: (m['unit_price'] as num?)?.toDouble(),
      );
}

/// An order half-written, on disk.
///
/// The same reasoning as `FormDraft`, and for the same reason it exists: on a
/// 4 GB handset Android will kill the app whenever something else needs the
/// memory, and everything held in `State` goes with it. An order is worse than
/// a form to lose — the rep is standing in front of a shopkeeper who has just
/// read out twenty lines, and there is no re-taking it.
///
/// Written to the key/value table the app already has, so this needs no drift
/// migration. Rewritten after every change rather than on a timer, because
/// there may be no further code running after the next line is typed.
class OrderDraft {
  const OrderDraft({
    required this.storeId,
    required this.lines,
    this.note,
    this.savedAt,
  });

  final String storeId;
  final List<OrderDraftLine> lines;
  final String? note;
  final DateTime? savedAt;

  /// Keyed by the visit, not the store: a rep who visits the same shop twice in
  /// a day is taking two orders, and the second must not resurrect the first.
  static String keyFor(String visitClientGeneratedId) =>
      'order_draft:$visitClientGeneratedId';

  String encode() => jsonEncode({
        'saved_at': (savedAt ?? DateTime.now()).toIso8601String(),
        'store_id': storeId,
        'note': note,
        'lines': lines.map((l) => l.toMap()).toList(),
      });

  static OrderDraft? decode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      final saved = DateTime.tryParse((map['saved_at'] as String?) ?? '');
      // A draft older than a week is a phone that was never opened again, not
      // an order anybody is still waiting on. Same ceiling as FormDraft.
      if (saved != null && DateTime.now().difference(saved) > maxAge) {
        return null;
      }
      return OrderDraft(
        storeId: map['store_id'] as String,
        note: map['note'] as String?,
        savedAt: saved,
        lines: ((map['lines'] as List?) ?? const [])
            .map((l) => OrderDraftLine.fromMap(
                Map<String, dynamic>.from(l as Map)))
            .toList(),
      );
    } catch (_) {
      // A corrupt value is dropped rather than crashing the screen the rep is
      // trying to use. The same call site clears it.
      return null;
    }
  }

  static const maxAge = Duration(days: 7);
}

class OrderDraftStore {
  OrderDraftStore(this._db);

  final AppDatabase _db;

  Future<OrderDraft?> load(String visitClientGeneratedId) async {
    final raw = await _db.getValue(OrderDraft.keyFor(visitClientGeneratedId));
    final draft = OrderDraft.decode(raw);
    if (draft == null && raw != null) {
      await clear(visitClientGeneratedId);
    }
    return draft;
  }

  Future<void> save(String visitClientGeneratedId, OrderDraft draft) =>
      _db.setValue(OrderDraft.keyFor(visitClientGeneratedId), draft.encode());

  Future<void> clear(String visitClientGeneratedId) =>
      _db.deleteValue(OrderDraft.keyFor(visitClientGeneratedId));
}
