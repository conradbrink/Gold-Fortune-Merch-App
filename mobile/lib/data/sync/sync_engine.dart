import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../../core/monitoring.dart';

/// Entries that keep failing this many times are left in the queue but no
/// longer retried automatically, so one poisoned row can't block the rest
/// forever. They stay visible to the rep as a sync problem.
const kMaxAttempts = 8;

/// The entries a drain may replay, oldest-first.
///
/// An entry that has exhausted [kMaxAttempts] is left behind rather than
/// retried, so one poisoned row cannot block the queue forever. What it must
/// not do is let the operations that *depended* on it carry on without it:
/// every operation shares its subject's client id — a check-out carries its
/// visit's, a workday end its session's — so anything queued behind a stalled
/// entry for the same id is held back with it.
///
/// Replaying a check-out whose check-in never landed updates no row, which
/// PostgREST reports as success, and the entry would then be deleted with the
/// rep's check-out inside it.
///
/// [alreadyStalled] carries the ids of entries the caller filtered out before
/// getting here. A drain asks the database to leave capped entries out of its
/// window — otherwise they fill it — which means this function can no longer see
/// them to work out what to hold back, so it is told instead.
List<OutboxEntry> replayableEntries(
  List<OutboxEntry> entries, {
  Set<String> alreadyStalled = const {},
}) {
  final stalled = <String>{...alreadyStalled};
  final replayable = <OutboxEntry>[];

  for (final entry in entries) {
    if (entry.attempts >= kMaxAttempts) {
      stalled.add(entry.clientGeneratedId);
      continue;
    }
    if (stalled.contains(entry.clientGeneratedId)) continue;
    replayable.add(entry);
  }

  return replayable;
}

enum SyncState { idle, syncing, offline, error }

class SyncStatus {
  final SyncState state;
  final int pending;
  final String? message;

  const SyncStatus({
    required this.state,
    required this.pending,
    this.message,
  });
}

/// Drains the local outbox against Supabase. Triggered by connectivity
/// regained, app foreground, and a slow safety-net timer.
class SyncEngine {
  SyncEngine(this._db, this._client);

  final AppDatabase _db;
  final SupabaseClient _client;

  final _statusController = StreamController<SyncStatus>.broadcast();
  Stream<SyncStatus> get status => _statusController.stream;

  StreamSubscription<List<ConnectivityResult>>? _connSub;
  Timer? _timer;
  bool _running = false;
  bool _online = true;

  void start() {
    _connSub = Connectivity().onConnectivityChanged.listen((results) {
      final online = !results.contains(ConnectivityResult.none);
      final wasOffline = !_online;
      _online = online;
      if (online && wasOffline) {
        // Back on the network — flush immediately.
        unawaited(sync());
      } else if (!online) {
        _emit(SyncState.offline);
      }
    });

    // Safety net for cases connectivity events miss (captive portals, flaky
    // signal that never reports a transition).
    _timer = Timer.periodic(const Duration(minutes: 2), (_) => sync());
    unawaited(sync());
  }

  void dispose() {
    _connSub?.cancel();
    _timer?.cancel();
    _statusController.close();
  }

  Future<void> _emit(SyncState state, {String? message}) async {
    if (_statusController.isClosed) return;
    final pending = await _db.pendingEntries(limit: 1000);
    _statusController.add(
      SyncStatus(state: state, pending: pending.length, message: message),
    );
  }

  /// Replays queued operations oldest-first. Safe to call concurrently —
  /// overlapping invocations are collapsed.
  Future<void> sync() async {
    if (_running) return;
    _running = true;

    try {
      // The window excludes entries that have given up, so a backlog of them
      // cannot crowd out newer work; their client ids come across separately so
      // whatever was queued behind them is still held back.
      final stalled = await _db.stalledClientIds(kMaxAttempts);
      final entries = await _db.pendingEntries(maxAttempts: kMaxAttempts);
      if (entries.isEmpty) {
        await _emit(SyncState.idle);
        return;
      }

      await _emit(SyncState.syncing);

      for (final entry in replayableEntries(entries, alreadyStalled: stalled)) {
        try {
          await _replay(entry);
          await _db.deleteEntry(entry.id);
        } on SocketException {
          // No network mid-drain: stop, keep everything queued, try later.
          await _emit(SyncState.offline);
          return;
        } catch (e, stack) {
          final attempts = entry.attempts + 1;
          await _db.recordFailure(entry.id, attempts, e.toString());

          // The failure worth waking someone up for. An entry that has used up
          // its attempts is work the rep believes is saved and which will now
          // never reach the server unaided — a visit, a form, a photo. Until
          // this existed, that was completely silent: the rep saw a pending
          // count that stopped falling and nothing else.
          //
          // Only the entry type and its id are reported. Never the payload:
          // it holds store data, GPS fixes and answers.
          if (attempts >= kMaxAttempts) {
            unawaited(Monitoring.report(
              e,
              stack,
              feature: 'sync',
              data: {
                'entity_type': entry.entityType,
                'attempts': attempts,
                'given_up': true,
              },
            ));
          } else {
            Monitoring.event('sync.retry', data: {
              'entity_type': entry.entityType,
              'attempts': attempts,
            });
          }

          // Stop on first failure so ordering is preserved — a check-out
          // must not be replayed before its check-in succeeds.
          await _emit(SyncState.error, message: e.toString());
          return;
        }
      }

      await _emit(SyncState.idle);
    } finally {
      _running = false;
    }
  }

  Future<void> _replay(OutboxEntry entry) async {
    final data = jsonDecode(entry.payload) as Map<String, dynamic>;

    switch (entry.entityType) {
      case OutboxType.visitCheckIn:
        // Upsert on the idempotency key so a retry can't duplicate a visit.
        await _client
            .from('visits')
            .upsert(data, onConflict: 'client_generated_id');
        break;

      case OutboxType.visitCheckOut:
        // An update that matches no row is a success as far as PostgREST is
        // concerned, and the caller would then delete this entry believing the
        // check-out was written. Ask for the affected row: no row means the
        // check-in has not landed, which is a reason to retry, not to discard
        // the only record that the rep finished the call.
        final visit = await _client
            .from('visits')
            .update(data['changes'] as Map<String, dynamic>)
            .eq('client_generated_id', data['client_generated_id'] as String)
            .select('id');
        if (visit.isEmpty) {
          throw StateError('Check-in not synced yet; will retry.');
        }
        break;

      case OutboxType.workdayStart:
        await _client
            .from('workday_sessions')
            .upsert(data, onConflict: 'client_generated_id');
        break;

      case OutboxType.workdayEnd:
        // Same silent-success hazard as the check-out above.
        final session = await _client
            .from('workday_sessions')
            .update(data['changes'] as Map<String, dynamic>)
            .eq('client_generated_id', data['client_generated_id'] as String)
            .select('id');
        if (session.isEmpty) {
          throw StateError('Workday start not synced yet; will retry.');
        }
        break;

      case OutboxType.locationPing:
        // The ping references its workday by client id; resolve it to the
        // real row (which may only just have synced).
        final sessionClientId =
            data.remove('workday_session_client_id') as String?;
        if (sessionClientId != null) {
          final session = await _client
              .from('workday_sessions')
              .select('id')
              .eq('client_generated_id', sessionClientId)
              .maybeSingle();
          if (session == null) {
            throw StateError('Workday not synced yet; will retry.');
          }
          data['workday_session_id'] = session['id'];
        }
        await _client
            .from('location_pings')
            .upsert(data, onConflict: 'client_generated_id');
        break;

      case OutboxType.salesVisitStart:
        // Upsert on the idempotency key, so a retry after a lost ack cannot
        // record the same call on the same prospect twice.
        await _client
            .from('leads')
            .upsert(data, onConflict: 'client_generated_id');
        break;

      case OutboxType.salesVisitComplete:
        // Same silent-success hazard as a check-out: an update matching no row
        // is a success to PostgREST, and this entry would then be deleted with
        // the outcome of the call inside it.
        final lead = await _client
            .from('leads')
            .update(data['changes'] as Map<String, dynamic>)
            .eq('client_generated_id', data['client_generated_id'] as String)
            .select('id');
        if (lead.isEmpty) {
          throw StateError('Sales call not synced yet; will retry.');
        }
        break;

      case OutboxType.orderCreate:
        await _replayOrder(data);
        break;

      case OutboxType.formSubmission:
        await _replayFormSubmission(data);
        break;

      case OutboxType.promotionCheck:
        // Resolve the visit if it has landed, and carry on without it if not.
        //
        // Deliberately NOT the `throw StateError` that form submissions use.
        // The drain stops on the first failure to preserve ordering, so a check
        // whose visit never syncs would hold back every entry behind it for
        // eight attempts. `promotion_checks.visit_id` is nullable and neither
        // report function reads it — the answer is about a store on a date, and
        // it is worth more recorded without the visit than not recorded at all.
        final visitClientId =
            data.remove('visit_client_generated_id') as String?;
        if (visitClientId != null) {
          final visit = await _client
              .from('visits')
              .select('id')
              .eq('client_generated_id', visitClientId)
              .maybeSingle();
          data['visit_id'] = visit?['id'];
        }
        await _client
            .from('promotion_checks')
            .upsert(data, onConflict: 'client_generated_id');
        break;

      default:
        // Unknown type (e.g. written by a newer build). Drop rather than
        // block the queue forever.
        break;
    }
  }

  /// Photos upload first so their real ids can be stitched into the
  /// responses. The whole thing keys off client_generated_id, so a partial
  /// replay resumes cleanly rather than duplicating.
  /// Sends an order the rep took in a shop.
  ///
  /// Not an upsert, unlike almost everything else here, and the difference
  /// matters. An order carries `order_number`, drawn from a gapless
  /// per-organisation counter, and upserting on `client_generated_id` would
  /// draw a fresh number on every retry — rewriting the reference the warehouse
  /// and the shop have already been given, and burning numbers out of a
  /// sequence whose whole point is that it has no gaps.
  ///
  /// So: look first. If the order is already there, the entry landed and only
  /// the acknowledgement was lost; carry on to the lines rather than touching
  /// the header. The same shape as `_uploadQueuedPhoto`'s did-this-already
  /// check, for the same reason.
  Future<void> _replayOrder(Map<String, dynamic> data) async {
    final orgId = data['org_id'] as String;
    final clientId = data['client_generated_id'] as String;

    final existing = await _client
        .from('orders')
        .select('id')
        .eq('client_generated_id', clientId)
        .maybeSingle();

    String orderId;
    if (existing != null) {
      orderId = existing['id'] as String;
    } else {
      // Drawn here, not on the phone. A number handed out while offline would
      // arrive out of sequence, and two reps offline at once would collide.
      final number = await _client.rpc(
        'next_document_number',
        params: {
          'p_org_id': orgId,
          'p_doc_type': 'order',
          'p_prefix': 'SO',
        },
      );

      final inserted = await _client
          .from('orders')
          .insert({
            'org_id': orgId,
            'order_number': number as String,
            'store_id': data['store_id'],
            'rep_id': data['rep_id'],
            'source': 'rep_app',
            'received_via': data['received_via'] ?? 'rep_visit',
            'notes': data['notes'],
            // Columns that have existed since the orders migration and that
            // this app never sent, so every rep order reached the warehouse
            // with nobody to ring and no date to work to.
            'contact_name': data['contact_name'],
            'contact_phone': data['contact_phone'],
            'required_by': data['required_by'],
            'client_generated_id': clientId,
          })
          .select('id')
          .single();
      orderId = inserted['id'] as String;
    }

    // Lines already present mean this entry landed completely. Checking the
    // child rather than trusting the header is what makes a crash between the
    // two recoverable instead of silent.
    //
    // The window between the two inserts is safe by construction rather than
    // by luck: `order_lines_insert` only admits a line while its order is
    // still `new`, and `order_confirm` refuses an order with no lines. So the
    // warehouse cannot move an order out from under a half-written entry — the
    // retry still finds it `new` and can finish the job.
    final lines = (data['lines'] as List?) ?? const [];
    if (lines.isEmpty) return;

    // Resolved line by line on each one's own idempotency key, not skipped
    // wholesale because one line arrived.
    //
    // The original check returned as soon as *any* line existed for the order,
    // which reads as "this already landed" and is only true when the insert
    // was all-or-nothing. A batch that half-applied left the order permanently
    // short: the rep sees it sent, the retry finds a line and gives up, and the
    // warehouse picks an order missing whatever did not make it. That is the
    // silent one — nothing errors, the order is simply wrong.
    //
    // Asking which keys are already there and inserting only the rest, rather
    // than upserting the lot. An upsert says the same thing far more neatly and
    // is what this did until it reached real handsets: PostgREST compiles one
    // into `insert ... on conflict do update set <every column sent>`, Postgres
    // demands UPDATE privilege on all of those columns, and `order_lines`
    // grants it on `qty_ordered` and `unit_price` alone — on purpose, so that
    // nothing but the fulfilment RPCs can move a line's stock figures. Every
    // rep order between 1.1.3 shipping and 05.08 therefore arrived with no
    // lines at all: header in, 42501 on the lines, retried until it gave up.
    //
    // So: still an upsert, but one that resolves a conflict by *ignoring* it.
    // `ignoreDuplicates` maps to `Prefer: resolution=ignore-duplicates`, which
    // PostgREST compiles to `on conflict do nothing` — and Postgres asks for no
    // UPDATE privilege at all to do nothing. Verified against production in a
    // rolled-back transaction with the four columns revoked, which is the state
    // this code has to survive:
    //
    //     first=[OK]  retry=[OK (no duplicate)]  do_update_without_grant=[42501]
    //
    // A read-then-insert would also have worked and was written first, but it
    // asks the same question in two round trips and leaves a window between
    // them: `client_generated_id` is unique across the whole table, so a
    // concurrent drain could insert between the look and the write and turn a
    // retry into a hard failure. One statement has no window.
    await _client.from('order_lines').upsert(
      [
        for (final raw in lines)
          {
            ...Map<String, dynamic>.from(raw as Map),
            'org_id': orgId,
            'order_id': orderId,
          }
      ],
      onConflict: 'client_generated_id',
      ignoreDuplicates: true,
    );
  }

  Future<void> _replayFormSubmission(Map<String, dynamic> data) async {
    final orgId = data['org_id'] as String;
    final repId = data['rep_id'] as String;
    final visitId = data['visit_id'] as String;

    // Resolve the server-side visit id: offline check-ins only know their
    // client_generated_id until they sync.
    String resolvedVisitId = visitId;
    final visitClientId = data['visit_client_generated_id'] as String?;
    if (visitClientId != null) {
      final row = await _client
          .from('visits')
          .select('id')
          .eq('client_generated_id', visitClientId)
          .maybeSingle();
      if (row == null) {
        throw StateError('Visit not synced yet; will retry.');
      }
      resolvedVisitId = row['id'] as String;
    }

    await _client.from('form_submissions').upsert({
      'org_id': orgId,
      'visit_id': resolvedVisitId,
      'form_template_id': data['form_template_id'],
      'rep_id': repId,
      'submitted_at': data['submitted_at'],
      'client_generated_id': data['client_generated_id'],
    }, onConflict: 'client_generated_id');

    final submission = await _client
        .from('form_submissions')
        .select('id')
        .eq('client_generated_id', data['client_generated_id'] as String)
        .single();
    final submissionId = submission['id'] as String;

    // Existing responses mean this entry already landed — don't double-write.
    final existing = await _client
        .from('form_responses')
        .select('id')
        .eq('form_submission_id', submissionId)
        .limit(1);
    if ((existing as List).isNotEmpty) return;

    final responses = <Map<String, dynamic>>[];
    for (final raw in (data['responses'] as List)) {
      final r = Map<String, dynamic>.from(raw as Map);

      final localPhotoPath = r.remove('local_photo_path') as String?;
      final photoClientId = r.remove('photo_client_generated_id') as String?;

      if (localPhotoPath != null && photoClientId != null) {
        r['photo_id'] = await _uploadQueuedPhoto(
          orgId: orgId,
          repId: repId,
          visitId: resolvedVisitId,
          localPath: localPhotoPath,
          clientGeneratedId: photoClientId,
          lat: (r.remove('photo_lat') as num?)?.toDouble(),
          lng: (r.remove('photo_lng') as num?)?.toDouble(),
          takenAt: r.remove('photo_taken_at') as String?,
        );
      }

      r['form_submission_id'] = submissionId;
      responses.add(r);
    }

    if (responses.isNotEmpty) {
      await _client.from('form_responses').insert(responses);
    }
  }

  Future<String?> _uploadQueuedPhoto({
    required String orgId,
    required String repId,
    required String visitId,
    required String localPath,
    required String clientGeneratedId,
    double? lat,
    double? lng,
    String? takenAt,
  }) async {
    // Already uploaded on a previous attempt?
    final existing = await _client
        .from('photos')
        .select('id')
        .eq('client_generated_id', clientGeneratedId)
        .maybeSingle();
    if (existing != null) return existing['id'] as String;

    final file = File(localPath);
    if (!file.existsSync()) {
      // The OS reclaimed the temp file. Better to record the answer without
      // the image than to fail the whole submission forever.
      return null;
    }

    final storagePath = '$orgId/$repId/$visitId/$clientGeneratedId.jpg';
    await _client.storage.from('visit-photos').upload(
          storagePath,
          file,
          fileOptions: const FileOptions(upsert: true),
        );

    final row = await _client
        .from('photos')
        .upsert({
          'org_id': orgId,
          'visit_id': visitId,
          'rep_id': repId,
          'storage_path': storagePath,
          'taken_at': takenAt,
          'uploaded_at': DateTime.now().toUtc().toIso8601String(),
          'lat': lat,
          'lng': lng,
          'client_generated_id': clientGeneratedId,
        }, onConflict: 'client_generated_id')
        .select('id')
        .single();

    return row['id'] as String;
  }
}
