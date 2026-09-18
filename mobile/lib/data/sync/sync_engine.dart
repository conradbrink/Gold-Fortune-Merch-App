import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:package_info_plus/package_info_plus.dart';
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
/// This is the *same-id* half of the rule. An entry can also depend on one
/// with a different id, named in its payload — a ping on its workday start,
/// a form on its check-in — and the drain holds those back using
/// [dependencyKeyOf], because the outbox key is what they share.
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

/// The queued operation this entry cannot land without, if it has one.
///
/// [replayableEntries] holds back work that shares a *client id* with a stalled
/// entry — a check-out behind its check-in. It cannot see the other kind of
/// dependency, the one written into the payload: a location ping names its
/// workday session, a form submission names its visit, and each has a client
/// id of its own. So a ping whose workday start had given up was replayed
/// anyway, asked the server for a session it had never heard of, and threw
/// "Workday not synced yet" — eight times, then reported as lost work, then the
/// next ping did the same. Forty-seven of those came off one handset in two
/// days (FLUTTER-3), and because the drain stops at the first failure, the
/// rep's check-ins sat behind that wall and reached the server one to two
/// days late.
///
/// Keyed by type as well as id, because a session's start and its end share
/// an id and only the start is what a ping is waiting for. A promotion check
/// deliberately has no entry here: it is recorded without its visit on
/// purpose (see the replay). Null for an entry that depends on nothing.
String? dependencyKeyOf(OutboxEntry entry) {
  final String parentType;
  final String payloadKey;
  switch (entry.entityType) {
    case OutboxType.locationPing:
      parentType = OutboxType.workdayStart;
      payloadKey = 'workday_session_client_id';
    case OutboxType.formSubmission:
      parentType = OutboxType.visitCheckIn;
      payloadKey = 'visit_client_generated_id';
    default:
      return null;
  }
  final Object? decoded;
  try {
    decoded = jsonDecode(entry.payload);
  } on FormatException {
    return null;
  }
  if (decoded is! Map) return null;
  final parentId = decoded[payloadKey];
  if (parentId is! String) return null;
  return outboxEntryKey(parentType, parentId);
}

/// A failure that says nothing about the entry and everything about the link.
///
/// The drain stops and waits on these rather than charging the entry an
/// attempt: a socket that never opened, a TLS handshake the network cut short,
/// an HTTP connection closed mid-response. All three are the phone passing out
/// of coverage, and all three are `IOException`s — but so is a missing file,
/// which *is* the entry's fault and must count, so the list is explicit rather
/// than the base class.
///
/// Two subclasses are carved back out. A `CertificateException` is a
/// `TlsException`, and a `RedirectException` is an `HttpException`, and
/// neither clears up by waiting: a certificate the phone will not trust is the
/// same certificate an hour later, and a redirect loop is a server, not a
/// signal. Treating those as transient would park the drain in "offline"
/// forever with the queue untouched and nobody told.
///
/// A fourth shape was missed and it was the expensive one. When the access
/// token has expired — the phone was in a pocket for an hour — the Supabase
/// client refreshes it before sending anything, and a refresh that fails for
/// want of a network surfaces as `AuthRetryableFetchException`, not as the
/// `SocketException` underneath it. That counted as the entry's fault. Eight
/// sync runs through a dead patch of signal — the timer alone gets there in
/// sixteen minutes — and the workday start at the head of the queue was given
/// up on. Worse, nobody heard: the report of that carries the exception's
/// name, and `Monitoring.scrub` drops anything naming it as offline noise. A
/// rep's whole day then queued behind a start the server was never going to
/// see, silently. It is retryable by definition, so it is transient here.
///
/// Top-level so it can be tested without a database.
bool isTransientNetworkFailure(Object error) {
  if (error is SocketException) return true;
  if (error is AuthRetryableFetchException) return true;
  if (error is TlsException) return error is! CertificateException;
  if (error is HttpException) return error is! RedirectException;
  return false;
}

/// Whether a queued check-out has already been recorded on the visit, and can
/// therefore be dropped from the outbox instead of retried forever.
///
/// Only true when the row is there **and** carries a `checkout_at`. The two
/// conditions are separate on purpose: a visit can be readable and still refuse
/// the update — a policy narrower on update than on select does exactly that,
/// and PostgREST reports the refusal as an empty result rather than an error.
/// Treating "the row exists" as "the check-out landed" would delete the only
/// record that the rep finished the call.
///
/// [visit] is the row as PostgREST returns it, or null when there is none.
bool checkOutAlreadyRecorded(Map<String, dynamic>? visit) =>
    visit != null && visit['checkout_at'] != null;

enum SyncState { idle, syncing, offline, error }

class SyncStatus {
  final SyncState state;
  final int pending;
  final String? message;

  const SyncStatus({required this.state, required this.pending, this.message});
}

/// Drains the local outbox against Supabase. Triggered by connectivity
/// regained, app foreground, and a slow safety-net timer.
class SyncEngine {
  SyncEngine(this._db, this._client, {Future<String?> Function()? readBuild})
    : _readBuild = readBuild ?? _installedBuild;

  final AppDatabase _db;
  final SupabaseClient _client;

  /// The running build's number, or null when it cannot be read.
  ///
  /// Injectable so a test can pretend to be an upgrade without a platform
  /// channel.
  final Future<String?> Function() _readBuild;

  static Future<String?> _installedBuild() async {
    try {
      return (await PackageInfo.fromPlatform()).buildNumber;
    } catch (_) {
      // No build number is no reason not to sync. The re-arm simply waits for
      // a launch that can read one.
      return null;
    }
  }

  /// Key/value slot recording the last build that re-armed stalled entries.
  static const _rearmedBuildKey = 'outbox_rearmed_for_build';

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
    // A new build gets one more go at anything that gave up on the old one,
    // before the first drain looks at the queue.
    unawaited(rearmForNewBuild().whenComplete(sync));
  }

  /// Gives stalled entries their attempts back, once per build.
  ///
  /// An entry that has used up [kMaxAttempts] is never retried, and that is
  /// right for as long as nothing has changed — the ninth attempt would fail
  /// like the eighth. A new build is the one thing that changes it: the reason
  /// an entry failed may have been fixed in the code, and until this existed
  /// the phone never found out. Returns how many entries were re-armed; zero
  /// when there were none or the build has been seen before.
  @visibleForTesting
  Future<int> rearmForNewBuild() async {
    final build = await _readBuild();
    if (build == null) return 0;
    if (await _db.getValue(_rearmedBuildKey) == build) return 0;
    final rearmed = await _db.rearmStalled(kMaxAttempts);
    await _db.setValue(_rearmedBuildKey, build);
    if (rearmed > 0) {
      Monitoring.event(
        'sync.rearmed',
        data: {'entries': rearmed, 'build': build},
      );
    }
    return rearmed;
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

      // Everything still on the phone, by type and id, so an entry can be asked
      // whether the thing it depends on has landed yet. Entries that land in
      // this very drain are struck off as they go — a ping queued straight
      // after its workday start must not wait a whole extra drain for it.
      final queued = await _db.queuedEntryKeys();
      final landed = <String>{};

      for (final entry in replayableEntries(entries, alreadyStalled: stalled)) {
        // A parent still on the phone — stalled, or somehow not yet replayed —
        // means the server cannot resolve this entry. Replaying it would only
        // spend an attempt on a foregone failure and stop the drain for
        // everything behind it. Held back, at no cost, and looked at again
        // next time.
        final dependency = dependencyKeyOf(entry);
        if (dependency != null &&
            queued.contains(dependency) &&
            !landed.contains(dependency)) {
          continue;
        }

        try {
          await _replay(entry, queued: queued);
          await _db.deleteEntry(entry.id);
          landed.add(outboxEntryKey(entry.entityType, entry.clientGeneratedId));
        } catch (e, stack) {
          // No network mid-drain: stop, keep everything queued, try later.
          //
          // This used to be `on SocketException` alone, and a TLS handshake
          // cut by a dropped cellular link is not a SocketException. It fell
          // through to the branch below, counted as one of the entry's eight
          // attempts, and after eight bad moments of signal a location ping
          // that had done nothing wrong was reported as given up (FLUTTER-D).
          if (isTransientNetworkFailure(e)) {
            await _emit(SyncState.offline);
            return;
          }
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
            unawaited(
              Monitoring.report(
                e,
                stack,
                feature: 'sync',
                data: {
                  'entity_type': entry.entityType,
                  'attempts': attempts,
                  'given_up': true,
                },
              ),
            );
          } else {
            Monitoring.event(
              'sync.retry',
              data: {'entity_type': entry.entityType, 'attempts': attempts},
            );
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

  /// Replays one entry. [queued] is every operation still on the phone, keyed
  /// as [outboxEntryKey], so a replay can tell "not landed yet" from "gone".
  Future<void> _replay(
    OutboxEntry entry, {
    Set<String> queued = const {},
  }) async {
    final data = jsonDecode(entry.payload) as Map<String, dynamic>;

    switch (entry.entityType) {
      case OutboxType.visitCheckIn:
        // Insert, or do nothing. This was a plain upsert on the idempotency
        // key, and the update half of an upsert is what bit: a rep who checks
        // in twice on the same visit — the second tap after the first had
        // already landed — queued a second entry carrying the same client id
        // and a *later* time, and `on conflict do update` walked it into the
        // guard in `20260729151556_lock_privilege_and_gps_fields`, which
        // refuses to let a recorded check-in time change. Permanently, so it
        // burned all eight attempts and was reported as a lost check-in
        // (FLUTTER-6 on 1.1.8) — while the check-out for that visit, sharing
        // its id, waited behind it. The recorded check-in is the one that
        // stands; a conflict is proof the visit is there.
        final inserted = await _client
            .from('visits')
            .upsert(
              data,
              onConflict: 'client_generated_id',
              ignoreDuplicates: true,
            )
            .select('id');
        if (inserted.isNotEmpty) break;

        // The row was already there. Either a manager pre-created the visit
        // for the route — no check-in on it yet, and this entry supplies one
        // — or it carries a check-in already, in which case this entry is
        // satisfied, not failed. The filter is what keeps the guard out of
        // it: an update that matches nothing is not refused, and matching
        // nothing is the whole answer when the row is already checked in.
        final claimed = await _client
            .from('visits')
            .update(data)
            .eq('client_generated_id', data['client_generated_id'] as String)
            .isFilter('checkin_at', null)
            .select('id');
        if (claimed.isEmpty) {
          Monitoring.event('sync.checkin_already_recorded');
        }
        break;

      case OutboxType.visitCheckOut:
        final checkOutId = data['client_generated_id'] as String;

        // An update that matches no row is a success as far as PostgREST is
        // concerned, and the caller would then delete this entry believing the
        // check-out was written. Ask for the affected row: no row means the
        // check-in has not landed, which is a reason to retry, not to discard
        // the only record that the rep finished the call.
        //
        // Restricted to a visit that is not already checked out. `checkOut`
        // stamps `DateTime.now()` at enqueue and `enqueue` is a plain insert,
        // so a rep who checks out twice — after process death loses the local
        // state, which the 1 GB handsets do — queues a second entry carrying a
        // *later* time. Sent unfiltered, that update walks into the guard in
        // `20260729151556_lock_privilege_and_gps_fields`, which refuses to let
        // a recorded check-out time change. The refusal is permanent: it will
        // still be there in eight attempts' time, and the drain stops on first
        // failure to preserve ordering, so everything the rep does afterwards
        // sits behind an entry that can never land (Sentry FLUTTER-6, A).
        final visit = await _client
            .from('visits')
            .update(data['changes'] as Map<String, dynamic>)
            .eq('client_generated_id', checkOutId)
            .isFilter('checkout_at', null)
            .select('id');

        if (visit.isEmpty) {
          // Nothing was updated, and the reasons need opposite handling. Ask
          // which one it is rather than guessing from the absence.
          final existing = await _client
              .from('visits')
              .select('id, checkout_at')
              .eq('client_generated_id', checkOutId)
              .maybeSingle();

          if (existing == null) {
            throw StateError('Check-in not synced yet; will retry.');
          }

          // The row being *visible* is not the same as the update having been
          // applied. A policy whose USING clause is narrower than the one on
          // select refuses the write while the row still reads back fine, and
          // PostgREST reports that refusal as an empty result rather than an
          // error. Deleting here on the strength of "the visit exists" would
          // throw away the only record that the rep finished the call — the
          // exact loss the affected-row check above was added to prevent.
          if (!checkOutAlreadyRecorded(existing)) {
            throw StateError('Check-out was not applied; will retry.');
          }

          // A check-out is genuinely on the row. The recorded time is the one
          // that stands — that is what the guard is for — so this entry is
          // *satisfied*, not failed. Returning normally lets the caller delete
          // it, which is the difference between a queue that drains and one
          // that wedges behind a write the database will refuse for as long as
          // the row exists.
        }
        break;

      case OutboxType.workdayStart:
        await _client
            .from('workday_sessions')
            .upsert(data, onConflict: 'client_generated_id');
        break;

      case OutboxType.workdayEnd:
        // Same silent-success hazard as the check-out above.
        final changes = data['changes'] as Map<String, dynamic>;
        final sessionClientId = data['client_generated_id'] as String;
        // An end the day gave itself at the cut-off must never replace an end
        // somebody chose — the rep's own, or a manager's on the web — that
        // landed first. A rep's own end stays unconditional, because it is
        // the one that stands even over a cut-off the server already applied.
        final automatic = changes['auto_ended_at'] != null;
        var update = _client
            .from('workday_sessions')
            .update(changes)
            .eq('client_generated_id', sessionClientId);
        if (automatic) update = update.isFilter('ended_at', null);
        final session = await update.select('id');
        if (session.isEmpty) {
          if (automatic) {
            final existing = await _client
                .from('workday_sessions')
                .select('id, ended_at')
                .eq('client_generated_id', sessionClientId)
                .maybeSingle();
            if (existing != null && existing['ended_at'] != null) {
              // Already ended by someone. This entry is satisfied, not failed.
              Monitoring.event('sync.auto_end_superseded');
              break;
            }
          }
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
            // The drain holds a ping back while its workday start is still on
            // the phone, so getting here with no session normally means the
            // start is *gone* — never queued, or cleared with the app's data
            // — and no amount of retrying will conjure it. Recorded without
            // the session link rather than given up on: the live map reads a
            // rep's pings by time, and a position with no day attached is
            // worth a great deal more than eight failures and a report.
            final startKey = outboxEntryKey(
              OutboxType.workdayStart,
              sessionClientId,
            );
            if (queued.contains(startKey)) {
              throw StateError('Workday not synced yet; will retry.');
            }
            Monitoring.event('sync.ping_without_session');
            data['workday_session_id'] = null;
          } else {
            data['workday_session_id'] = session['id'];
          }
        }
        // `ignoreDuplicates`, and it is load-bearing. A plain upsert is
        // `insert … on conflict do update`, and the update half runs under the
        // table's UPDATE policy — which `location_pings` does not have. So a
        // ping retried after a lost acknowledgement, whose row was already
        // there, was refused with "violates row-level security policy (USING
        // expression)" on every attempt, burned all eight, and was reported as
        // lost work (FLUTTER-6, FLUTTER-A, three reps). It was never lost: the
        // conflict *is* the proof it landed. A ping is immutable, so "do
        // nothing" on conflict is the whole truth, not a shortcut.
        await _client
            .from('location_pings')
            .upsert(
              data,
              onConflict: 'client_generated_id',
              ignoreDuplicates: true,
            );
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
        // Same trap as the location ping above: `promotion_checks` has an
        // INSERT policy and no UPDATE policy, so a retry that meets its own
        // earlier row must not take the update path. A check cannot be edited
        // afterwards by design, so nothing is given up here.
        await _client
            .from('promotion_checks')
            .upsert(
              data,
              onConflict: 'client_generated_id',
              ignoreDuplicates: true,
            );
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
        params: {'p_org_id': orgId, 'p_doc_type': 'order', 'p_prefix': 'SO'},
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
    await _client
        .from('order_lines')
        .upsert(
          [
            for (final raw in lines)
              {
                ...Map<String, dynamic>.from(raw as Map),
                'org_id': orgId,
                'order_id': orderId,
              },
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
    await _client.storage
        .from('visit-photos')
        .upload(
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
