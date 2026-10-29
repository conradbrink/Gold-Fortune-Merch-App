import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/delivery.dart';
import '../sync/sync_engine.dart';

/// What became of a drop just recorded, as far as the phone can tell within
/// a few seconds ([DeliveryRepository.sendDrop]).
enum DropOutcome {
  /// Still on the phone: no signal, slow, or refused for now and tried again.
  waiting,

  /// The warehouse has it.
  delivered,

  /// Sent, and not taken: the warehouse had already returned the dispatch or
  /// given it to somebody else.
  notTaken,
}

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
///
/// The one thing that is queued is the driver recording the drop
/// ([confirmDelivery]): it is done at the shop's back door, where the signal
/// often is not, and it must not be lost.
class DeliveryRepository {
  DeliveryRepository(this._client, this._db, this._sync);

  final SupabaseClient _client;
  final AppDatabase _db;
  final SyncEngine _sync;

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
received_signature_path, order_id, order:orders(order_number, customer_po_number, customer_po_expires_on,
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

  /// Records the drop: everything on the dispatch was taken, [receivedBy]
  /// signed for it on the phone ([signature], a PNG), and [photo], when the
  /// driver took one, is the signed delivery note.
  ///
  /// Queued, not sent: the signature is written to the app's own folder and
  /// the photo copied out of the camera's cache (Android may empty it), then
  /// one outbox entry, keyed by the dispatch, is replayed by `SyncEngine` as
  /// upload-then-`delivery_confirm()`. Full deliveries only (owner, 27 Oct
  /// 2026): a short drop is the warehouse's to record. The signature is
  /// required and the photo optional (owner, 29 Oct 2026).
  Future<void> confirmDelivery({
    required String orgId,
    required String repId,
    required DeliveryDetail delivery,
    required String receivedBy,
    required Uint8List signature,
    File? photo,
  }) async {
    final orderId = delivery.orderId;
    if (orderId == null) {
      throw StateError('This delivery has no order on record.');
    }
    final signatureId = const Uuid().v4();
    final photoId = photo == null ? null : const Uuid().v4();
    final dir = await getApplicationDocumentsDirectory();
    final podDir = Directory(p.join(dir.path, 'pending_pod'));
    if (!podDir.existsSync()) podDir.createSync(recursive: true);
    final signed = await File(p.join(podDir.path, '$signatureId.png')).writeAsBytes(signature, flush: true);
    File? kept;
    try {
      kept = photo == null ? null : await photo.copy(p.join(podDir.path, '$photoId.jpg'));
    } catch (_) {
      await _deleteQuietly(signed.path);
      rethrow;
    }
    final dispatchId = delivery.delivery.id;

    // An earlier try for this dispatch that gave up is replaced, not left in
    // front: the drain holds back anything sharing a client id with a stalled
    // entry, so the new one would never be sent behind it.
    final List<OutboxEntry> replaced;
    try {
      replaced = await _db.transaction(() async {
        final old = await _db.entriesFor(OutboxType.deliveryConfirm, dispatchId);
        await _db.deleteEntriesFor(OutboxType.deliveryConfirm, dispatchId);
        await _db.enqueue(
          entityType: OutboxType.deliveryConfirm,
          clientGeneratedId: dispatchId,
          payload: jsonEncode({
            'org_id': orgId,
            'rep_id': repId,
            'dispatch_id': dispatchId,
            'order_id': orderId,
            'received_by_name': receivedBy.trim(),
            'delivered_at': DateTime.now().toUtc().toIso8601String(),
            'signature_client_id': signatureId,
            'local_signature_path': signed.path,
            'photo_client_id': photoId,
            'local_photo_path': kept?.path,
          }),
        );
        return old;
      });
    } catch (_) {
      // Nothing queued, so nothing will ever upload these copies.
      await _deleteQuietly(signed.path);
      await _deleteQuietly(kept?.path);
      rethrow;
    }
    for (final e in replaced) {
      try {
        final old = jsonDecode(e.payload) as Map<String, dynamic>;
        await _deleteQuietly(old['local_signature_path'] as String?);
        await _deleteQuietly(old['local_photo_path'] as String?);
      } catch (_) {
        // An unreadable old payload costs space, not the delivery.
      }
    }
    unawaited(_sync.sync());
  }

  static Future<void> _deleteQuietly(String? path) async {
    if (path == null) return;
    try {
      await File(path).delete();
    } catch (_) {
      // Already gone.
    }
  }

  /// Sends the drop just recorded for [dispatchId], waiting a few seconds,
  /// and says what became of it, so the screen says "delivered" only when the
  /// warehouse has it.
  Future<DropOutcome> sendDrop(String dispatchId) async {
    if (!await _sync.sentWithin(OutboxType.deliveryConfirm, dispatchId)) {
      return DropOutcome.waiting;
    }
    // Gone from the phone is accepted, or let go because the warehouse had
    // already returned the dispatch or given it to somebody else
    // (`isFinalDeliveryRefusal`). Only the dispatch can tell the two apart.
    try {
      final row = await _client
          .from('dispatches')
          .select('status')
          .eq('id', dispatchId)
          .maybeSingle();
      return row?['status'] == 'delivered' ? DropOutcome.delivered : DropOutcome.notTaken;
    } catch (_) {
      // It reached the server and was not refused in the rare way above; the
      // screen asks again for the dispatch when it can.
      return DropOutcome.delivered;
    }
  }

  /// Whether the drop queued for [dispatchId] carries a photo of the
  /// delivery note, which is optional beside the signature. Only one still on
  /// the phone counts: a copy Android has cleared is left out when the drop is
  /// sent (`SyncEngine._replayDeliveryConfirm`), so it must not be promised.
  Future<bool> queuedWithPhoto(String dispatchId) async {
    for (final e in await _db.entriesFor(OutboxType.deliveryConfirm, dispatchId)) {
      try {
        final data = jsonDecode(e.payload) as Map<String, dynamic>;
        final path = data['local_photo_path'];
        if (path is String && File(path).existsSync()) return true;
      } catch (_) {
        // An unreadable payload says nothing about a photo.
      }
    }
    return false;
  }

  /// Dispatches whose drop this phone has recorded and is still trying to
  /// send. One that has given up is left out, so the screen offers "Record
  /// delivery" again rather than saying "waiting for signal" for good.
  Future<Set<String>> pendingConfirms() =>
      _db.retryingClientIds(OutboxType.deliveryConfirm, kMaxAttempts);

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
