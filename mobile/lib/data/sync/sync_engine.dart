import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../local/app_database.dart';
import '../local/outbox_types.dart';

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
List<OutboxEntry> replayableEntries(List<OutboxEntry> entries) {
  final stalled = <String>{};
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
      final entries = await _db.pendingEntries();
      if (entries.isEmpty) {
        await _emit(SyncState.idle);
        return;
      }

      await _emit(SyncState.syncing);

      for (final entry in replayableEntries(entries)) {
        try {
          await _replay(entry);
          await _db.deleteEntry(entry.id);
        } on SocketException {
          // No network mid-drain: stop, keep everything queued, try later.
          await _emit(SyncState.offline);
          return;
        } catch (e) {
          await _db.recordFailure(entry.id, entry.attempts + 1, e.toString());
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
