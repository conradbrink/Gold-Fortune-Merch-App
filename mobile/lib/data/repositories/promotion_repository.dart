import 'dart:async';
import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/promotion.dart';
import '../sync/sync_engine.dart';

const _uuid = Uuid();

/// Today in the rep's own timezone, as `yyyy-MM-dd`.
///
/// Never `toUtc()`. Botswana is UTC+2, so a UTC date would show tomorrow's
/// promotions from 22:00 and hide today's until 02:00.
String localToday([DateTime? now]) {
  final d = now ?? DateTime.now();
  return '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}

/// An answer already given, whether or not it has reached the server.
class PromotionAnswer {
  final String promotionId;
  final String productId;
  final String status;
  final DateTime? checkedAt;

  /// True when this answer was given during the visit currently on screen.
  /// A month-long promotion answered three weeks ago is context, not a
  /// completed job — the rep is standing in the shop again today.
  final bool thisVisit;

  const PromotionAnswer({
    required this.promotionId,
    required this.productId,
    required this.status,
    this.checkedAt,
    required this.thisVisit,
  });

  static String key(String promotionId, String productId) =>
      '$promotionId:$productId';
}

class PromotionRepository {
  PromotionRepository(this._client, this._db, this._sync);

  final SupabaseClient _client;
  final AppDatabase _db;
  final SyncEngine _sync;

  static const _cacheKey = 'promotions';

  /// Every live promotion in the org, cached whole.
  ///
  /// Deliberately not per-store. Forms survive a lost signal because the depot
  /// warm-up fetches them once for the whole day; a per-store fetch would put
  /// the rep back to needing signal at each door, which is exactly the problem
  /// that warm-up solved. Two hundred stores across a handful of promotions is
  /// a few tens of kilobytes.
  Future<List<Promotion>> fetchLivePromotions() async {
    final today = localToday();
    try {
      final rows = await _client
          .from('promotions')
          .select(
            'id, name, brief, starts_on, ends_on, '
            'promotion_stores(store_id), '
            'promotion_products(products(id, name, brand))',
          )
          .eq('active', true)
          .lte('starts_on', today)
          .gte('ends_on', today);

      final promotions = (rows as List)
          .map((r) => Promotion.fromMap(r as Map<String, dynamic>))
          .toList();

      await _db.setValue(
        _cacheKey,
        jsonEncode(promotions.map((p) => p.toMap()).toList()),
      );
      return promotions;
    } catch (_) {
      return _cached();
    }
  }

  Future<List<Promotion>> _cached() async {
    final raw = await _db.getValue(_cacheKey);
    if (raw == null) return [];
    final today = localToday();
    return (jsonDecode(raw) as List)
        .map((p) => Promotion.fromMap(p as Map<String, dynamic>))
        // The window is re-applied here as well as on the server, because the
        // cache is stale by construction — it may have been written days ago.
        .where((p) => p.coversDate(today))
        .toList();
  }

  /// The promotions that apply at one store today.
  static List<Promotion> forStore(List<Promotion> all, String storeId) =>
      all.where((p) => p.coversStore(storeId)).toList();

  /// Answers already recorded for this store, keyed `promotionId:productId`.
  ///
  /// Unions the outbox with the server so an answer given a moment ago offline
  /// shows as answered immediately, exactly as submitted forms do.
  Future<Map<String, PromotionAnswer>> answersForStore({
    required String storeId,
    required String visitClientGeneratedId,
  }) async {
    final answers = <String, PromotionAnswer>{};

    try {
      final rows = await _client
          .from('promotion_checks')
          .select('promotion_id, product_id, status, checked_at')
          .eq('store_id', storeId)
          .order('checked_at', ascending: false);

      for (final r in (rows as List).cast<Map<String, dynamic>>()) {
        final k = PromotionAnswer.key(
            r['promotion_id'] as String, r['product_id'] as String);
        // Ordered newest first, so the first one wins and later rows are the
        // history behind it.
        answers.putIfAbsent(
          k,
          () => PromotionAnswer(
            promotionId: r['promotion_id'] as String,
            productId: r['product_id'] as String,
            status: r['status'] as String,
            checkedAt: r['checked_at'] != null
                ? DateTime.parse(r['checked_at'] as String).toLocal()
                : null,
            thisVisit: false,
          ),
        );
      }
    } catch (_) {
      // Offline: the outbox below is still authoritative for this visit.
    }

    // Pending entries always win — they are newer than anything on the server.
    for (final entry in await _db.pendingEntries(limit: 1000)) {
      if (entry.entityType != OutboxType.promotionCheck) continue;
      final data = jsonDecode(entry.payload) as Map<String, dynamic>;
      if (data['store_id'] != storeId) continue;
      final k = PromotionAnswer.key(
          data['promotion_id'] as String, data['product_id'] as String);
      answers[k] = PromotionAnswer(
        promotionId: data['promotion_id'] as String,
        productId: data['product_id'] as String,
        status: data['status'] as String,
        checkedAt: null,
        thisVisit: data['visit_client_generated_id'] == visitClientGeneratedId,
      );
    }

    return answers;
  }

  /// Records one answer. Queued, so it works with no signal.
  ///
  /// Always an insert, never an update: `promotion_checks` has no update policy
  /// by design — a check is a statement about a moment, and the way to correct
  /// it is to make a newer one. The reports read the latest per line, so a
  /// re-tap supersedes cleanly and a mis-tap never becomes permanent record.
  Future<void> recordAnswer({
    required String orgId,
    required String repId,
    required String storeId,
    required String promotionId,
    required String productId,
    required String status,
    required String? visitClientGeneratedId,
    String? note,
  }) async {
    final clientId = _uuid.v4();
    await _db.enqueue(
      entityType: OutboxType.promotionCheck,
      clientGeneratedId: clientId,
      payload: jsonEncode({
        'org_id': orgId,
        'promotion_id': promotionId,
        'product_id': productId,
        'store_id': storeId,
        'rep_id': repId,
        'status': status,
        'note': note,
        'checked_at': DateTime.now().toUtc().toIso8601String(),
        'client_generated_id': clientId,
        // Resolved to a real visit id by the sync engine, or dropped if the
        // visit never syncs.
        'visit_client_generated_id': visitClientGeneratedId,
      }),
    );
    unawaited(_sync.sync());
  }
}
