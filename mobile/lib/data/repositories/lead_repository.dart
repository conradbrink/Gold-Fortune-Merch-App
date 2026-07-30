import 'dart:async';
import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../../core/location_service.dart';
import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/lead.dart';
import '../sync/sync_engine.dart';

const _uuid = Uuid();

/// Sales calls on prospects, queued locally first.
///
/// Same contract as every other rep write here: the call is durable the moment
/// the rep taps, and the network catches up later. A rep standing in a shop
/// with no signal is the normal case, not the edge one.
///
/// Cached as a JSON list under one key rather than in a table of its own,
/// which is what promotions and stores already do — the rep's own calls are a
/// short list that is only ever read whole.
class LeadRepository {
  LeadRepository(this._db, this._sync);

  final AppDatabase _db;
  final SyncEngine _sync;

  static const _cacheKey = 'leads';

  Future<List<Lead>> _cached() async {
    final raw = await _db.getValue(_cacheKey);
    if (raw == null) return [];
    return (jsonDecode(raw) as List)
        .map((l) => Lead.fromMap(l as Map<String, dynamic>))
        .toList();
  }

  Future<void> _save(List<Lead> leads) async {
    await _db.setValue(
      _cacheKey,
      jsonEncode(leads.map((l) => l.toMap()).toList()),
    );
  }

  /// Newest first. Calls still open sort above finished ones, because an
  /// unfinished call is a thing the rep still has to do something about.
  Future<List<Lead>> myLeads() async {
    final leads = await _cached();
    leads.sort((a, b) {
      if (a.isComplete != b.isComplete) return a.isComplete ? 1 : -1;
      return b.startedAt.compareTo(a.startedAt);
    });
    return leads;
  }

  Future<List<Lead>> inProgress() async =>
      (await myLeads()).where((l) => !l.isComplete).toList();

  Future<Lead?> byClientId(String clientGeneratedId) async {
    for (final lead in await _cached()) {
      if (lead.clientGeneratedId == clientGeneratedId) return lead;
    }
    return null;
  }

  /// Records the start of a sales call: who is being visited and why.
  ///
  /// The position is taken here and never again. It is the evidence that the
  /// rep was at the door, and the server refuses to let it be changed
  /// afterwards — so a failure to read it is recorded as absent rather than
  /// filled in later from somewhere less honest.
  Future<Lead> start({
    required String orgId,
    required String repId,
    required String companyName,
    required String purpose,
    String? contactName,
    String? contactPhone,
  }) async {
    double? lat;
    double? lng;
    try {
      final position = await LocationService.getCurrentPosition();
      lat = position.latitude;
      lng = position.longitude;
    } catch (_) {
      // No fix — permission refused, or indoors in a metal shed. The call is
      // still worth recording; it just cannot claim a position.
    }

    final lead = Lead(
      clientGeneratedId: _uuid.v4(),
      orgId: orgId,
      repId: repId,
      companyName: companyName.trim(),
      purpose: purpose.trim(),
      contactName: (contactName?.trim().isEmpty ?? true) ? null : contactName!.trim(),
      contactPhone: (contactPhone?.trim().isEmpty ?? true) ? null : contactPhone!.trim(),
      startedAt: DateTime.now(),
      startLat: lat,
      startLng: lng,
    );

    // Cache and outbox in one transaction. Two reasons, both of which produce a
    // record that looks fine on the phone and never reaches the server:
    //
    // - Order. `_save` before `enqueue` meant a failed enqueue left the call
    //   listed locally with nothing queued to send it. The rep sees their work;
    //   the office never does.
    // - Atomicity. `_cached()` → mutate → `_save()` is a read-modify-write on
    //   one JSON blob, and both this and `complete()` await a GPS fix first —
    //   seconds during which the other can interleave and write back a list
    //   taken before this lead existed. Drift serialises transactions, so
    //   holding the read and the write inside one closes that.
    await _db.transaction(() async {
      await _db.enqueue(
        entityType: OutboxType.salesVisitStart,
        clientGeneratedId: lead.clientGeneratedId,
        payload: jsonEncode({
          'org_id': lead.orgId,
          'rep_id': lead.repId,
          'company_name': lead.companyName,
          'purpose': lead.purpose,
          'contact_name': lead.contactName,
          'contact_phone': lead.contactPhone,
          'started_at': lead.startedAt.toUtc().toIso8601String(),
          'start_lat': lead.startLat,
          'start_lng': lead.startLng,
          'status': 'in_progress',
          'client_generated_id': lead.clientGeneratedId,
        }),
      );

      final leads = await _cached()..add(lead);
      await _save(leads);
    });

    unawaited(_sync.sync());
    return lead;
  }

  /// Closes the call off with what came of it.
  ///
  /// Queued as a separate entry sharing the call's client id, so the drain
  /// replays it after the start it depends on — and never without it.
  Future<Lead> complete({
    required Lead lead,
    required String outcome,
    String? notes,
    required bool followUpRequired,
    String? followUpOn,
  }) async {
    double? lat;
    double? lng;
    try {
      final position = await LocationService.getCurrentPosition();
      lat = position.latitude;
      lng = position.longitude;
    } catch (_) {
      // Same as the start: absent is honest, invented is not.
    }

    final completed = lead.copyWith(
      outcome: outcome.trim(),
      notes: (notes?.trim().isEmpty ?? true) ? null : notes!.trim(),
      followUpRequired: followUpRequired,
      followUpOn: followUpRequired ? followUpOn : null,
      completedAt: DateTime.now(),
      endLat: lat,
      endLng: lng,
      status: 'completed',
    );

    // One transaction, outbox first — same reasoning as `start()`. A completed
    // call that shows its outcome on the phone but queued nothing is the worst
    // of the failure modes here, because nothing about it looks wrong.
    await _db.transaction(() async {
      await _db.enqueue(
        entityType: OutboxType.salesVisitComplete,
        clientGeneratedId: completed.clientGeneratedId,
        payload: jsonEncode({
          'client_generated_id': completed.clientGeneratedId,
          'changes': {
            'outcome': completed.outcome,
            'notes': completed.notes,
            'follow_up_required': completed.followUpRequired,
            'follow_up_on': completed.followUpOn,
            'completed_at': completed.completedAt!.toUtc().toIso8601String(),
            'end_lat': completed.endLat,
            'end_lng': completed.endLng,
            'status': 'completed',
          },
        }),
      );

      final leads = await _cached();
      final index =
          leads.indexWhere((l) => l.clientGeneratedId == lead.clientGeneratedId);
      if (index >= 0) {
        leads[index] = completed;
      } else {
        leads.add(completed);
      }
      await _save(leads);
    });

    unawaited(_sync.sync());
    return completed;
  }
}

/// Today's date in the rep's own timezone, `yyyy-MM-dd`.
///
/// Never `DateTime.toIso8601String()` on a UTC value: Botswana is UTC+2, so a
/// follow-up set in the evening would land on the previous day.
String localDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-'
    '${date.month.toString().padLeft(2, '0')}-'
    '${date.day.toString().padLeft(2, '0')}';
