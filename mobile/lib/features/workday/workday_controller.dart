import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/location_tracking.dart';
import '../../core/providers.dart';
import '../../data/models/workday_session.dart';

export '../../core/location_tracking.dart'
    show kLocationPingInterval, LocationTrackingMode;

class WorkdayController extends AsyncNotifier<WorkdaySession?> {
  StreamSubscription<Position>? _pingSub;
  Position? _lastPingPosition;
  /// When the last ping was *written*, to enforce [kMinPingSpacing].
  DateTime? _lastPingAt;
  LocationTrackingMode _trackingMode = LocationTrackingMode.unavailable;

  /// Bumped by every start and every stop, so an in-flight start can tell that
  /// it has been overtaken. See [_startTracking].
  int _trackingGeneration = 0;

  /// How much of the trail this rep's permissions actually allow.
  ///
  /// Read by the banner so a rep granting only "while using the app" is told
  /// their route stops recording when they put the phone away, rather than the
  /// manager discovering the gap a week later.
  LocationTrackingMode get trackingMode => _trackingMode;

  @override
  Future<WorkdaySession?> build() async {
    // Must outlive any one screen — navigating to a store shouldn't wipe the
    // active session or drop the location subscription.
    ref.keepAlive();
    ref.onDispose(() => unawaited(_cancelPings()));

    final user = ref.watch(currentUserProvider);
    if (user == null) {
      unawaited(_stopTracking());
      return null;
    }

    final repo = ref.read(workdayRepositoryProvider);
    final session = await repo.fetchActiveSession(user.id);

    if (session != null) {
      // Resubscribes after a cold start, so a rep whose phone was killed
      // mid-round starts recording again the moment the app is reopened.
      unawaited(_startTracking());
    } else {
      unawaited(_stopTracking());
      // Only worth asking when there is no open day: a rep with a session
      // running is plainly not finished, and this would be a wasted request
      // on every rebuild.
      _closedToday = await repo.hasClosedWorkdayToday(user.id);
    }
    return session;
  }

  bool _closedToday = false;

  /// True once the rep has closed a workday today. The day cannot be restarted
  /// until tomorrow — see `WorkdayRepository.hasClosedWorkdayToday`.
  ///
  /// Read by the banner rather than folded into the session state, because
  /// "no open day" and "day already finished" are different things to show and
  /// collapsing them would put a Start button in front of a rep who has
  /// already gone home.
  bool get isClosedForToday => _closedToday;

  /// Subscribes to the platform's position stream for the open day.
  ///
  /// Replaces a `Timer.periodic`, which is the whole point of this change: a
  /// Dart timer stops when Android suspends the process, and measurement against
  /// production showed the old one delivering **3.6%** of the pings it promised,
  /// with 14 of 23 sessions recording none at all. The platform keeps sampling
  /// where a timer cannot — see `core/location_tracking.dart` for what that does
  /// and does not guarantee.
  Future<void> _startTracking() async {
    // Claim this attempt. `currentMode()` is a channel round trip, and `build()`
    // re-runs on sign-out — so a start begun before sign-out can resume *after*
    // `_stopTracking` has already cancelled everything, and assign a fresh
    // subscription with nobody left to own it. That subscription holds the
    // foreground service open: a rep who has signed out keeps a "Workday in
    // progress" notice and keeps sampling GPS. The token is what makes a start
    // abandonable partway through.
    final generation = ++_trackingGeneration;
    bool superseded() => generation != _trackingGeneration;

    await _cancelPings();
    if (superseded()) return;

    _trackingMode = await LocationTracking.currentMode();
    if (superseded()) return;

    final stream = LocationTracking.stream(_trackingMode);
    if (stream == null) {
      ref.notifyListeners();
      return;
    }

    final sub = stream.listen(
      _onPosition,
      // A stream error is how a mid-day revocation arrives: permission taken
      // away, or location services switched off, while the day is open. Dropping
      // it silently left the banner still promising "recording every 5 min" after
      // recording had stopped — the one thing the notice exists to prevent.
      //
      // The subscription is deliberately *not* torn down: a transient fix
      // failure must not end the day, and `cancelOnError: false` keeps the
      // stream alive so it resumes if the rep restores the grant.
      // Synchronous, and the refresh fired from inside it. `Stream.listen` does
      // not await what `onError` returns, so an `async` callback that throws —
      // `currentMode()` hitting a dead platform channel, say — becomes an
      // unhandled asynchronous error and takes the zone down. The work is
      // started here and its failure caught there.
      onError: (_) {
        unawaited(_refreshTrackingMode());
      },
      cancelOnError: false,
    );

    // Listening is itself an await-free step, but a stop can have landed while
    // the stream was being built. Cancelling here rather than keeping it is the
    // difference between a stray service and none.
    if (superseded()) {
      await _cancelSubscription(sub);
      return;
    }

    _pingSub = sub;
    ref.notifyListeners();
  }

  /// Re-reads the grant after the stream has complained.
  ///
  /// A stream error is how a mid-day revocation arrives — permission taken away,
  /// or location services switched off, while the day is open. Left unread, the
  /// banner goes on promising "recording your route every 5 min" after recording
  /// has stopped, which is the false reassurance the notice exists to remove.
  ///
  /// Its own failure is swallowed on purpose: not knowing the mode is no reason
  /// to end a rep's day, and the next error or restart asks again.
  Future<void> _refreshTrackingMode() async {
    try {
      final mode = await LocationTracking.currentMode();
      if (mode != _trackingMode) {
        _trackingMode = mode;
        ref.notifyListeners();
      }
    } catch (_) {
      // Deliberately ignored — see above.
    }
  }

  /// Ends the subscription, which is what stops the foreground service and
  /// clears its notification. A rep who has finished for the day must not be
  /// left with a "Workday in progress" notice, or a service still sampling GPS.
  Future<void> _stopTracking() async {
    // Invalidate any start still in flight *before* awaiting, or it can finish
    // afterwards and hand back a subscription this stop was meant to prevent.
    _trackingGeneration++;
    await _cancelPings();
  }

  Future<void> _cancelPings() async {
    final sub = _pingSub;
    _pingSub = null;
    if (sub != null) await _cancelSubscription(sub);
  }

  /// Cancels a position subscription, accepting that it may already be gone.
  ///
  /// geolocator's Android side throws `PlatformException(No active stream to
  /// cancel)` when the stream it is asked to cancel never started — which is
  /// what happens after Android refuses the foreground service (`Service.
  /// startForeground() not allowed`, the app being in the background when the
  /// controller rebuilt after a low-memory kill). The stream errors, the
  /// platform side tears itself down, and the next cancel here has nothing to
  /// cancel. That is the outcome a cancel wants, and 42 of them came off two
  /// handsets in a week as unhandled errors (FLUTTER-C) for reporting it as a
  /// failure.
  ///
  /// Only `PlatformException` is caught. Anything else a cancel throws is
  /// unknown and should still be seen.
  static Future<void> _cancelSubscription(
      StreamSubscription<Position> sub) async {
    try {
      await sub.cancel();
    } on PlatformException {
      // Already stopped. Nothing to do and nothing to report.
    }
  }

  /// One position from the stream, rate-limited into at most one written ping.
  ///
  /// Now that sampling is time-based this is the *only* rate limit — the 75 m
  /// distance filter that used to bound a stationary rep is gone, so without
  /// [shouldRecordPing] every fix the platform produced would be written.
  Future<void> _onPosition(Position position) async {
    final now = DateTime.now();
    if (!shouldRecordPing(now: now, lastPingAt: _lastPingAt)) return;
    _lastPingAt = now;
    await _ping(position);
  }

  Future<void> _ping(Position position) async {
    final session = state.value;
    final profile = ref.read(profileProvider).value;
    if (session == null || profile == null) return;

    try {
      final repo = ref.read(workdayRepositoryProvider);
      final result = await repo.recordIntervalPing(
        orgId: profile.orgId,
        repId: profile.id,
        sessionClientId: session.clientGeneratedId,
        last: _lastPingPosition,
        position: position,
      );
      _lastPingPosition = result.position;
      // Mileage accrues locally so it stays correct with no connection, and
      // is cached so a restart mid-day doesn't reset the odometer.
      final updated = session.copyWith(
        distanceMeters: session.distanceMeters + result.legMeters,
      );
      await repo.cacheActiveSession(updated);
      state = AsyncData(updated);
    } catch (_) {
      // A single failed write (offline, permission revoked mid-day) must not
      // tear down the subscription — the next position from the stream tries
      // again, and `queuePing` has already put it in the outbox regardless.
    }
  }

  Future<void> startWorkday() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) return;

    // Guarded here as well as in the UI. Hiding the button is a UI state; this
    // is the write, and the write is what needs preventing — a stale screen or
    // a double tap must not be able to open a second day.
    if (await ref
        .read(workdayRepositoryProvider)
        .hasClosedWorkdayToday(profile.id)) {
      _closedToday = true;
      ref.notifyListeners();
      return;
    }

    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final repo = ref.read(workdayRepositoryProvider);
      final session = await repo.startWorkday(
        orgId: profile.orgId,
        repId: profile.id,
      );
      _lastPingPosition = null;
      _lastPingAt = null;
      await _startTracking();
      return session;
    });
  }

  Future<void> endWorkday() async {
    final profile = ref.read(profileProvider).value;
    final session = state.value;
    if (profile == null || session == null) return;

    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final repo = ref.read(workdayRepositoryProvider);
      await repo.endWorkday(
        orgId: profile.orgId,
        repId: profile.id,
        session: session,
        distanceMeters: session.distanceMeters,
      );
      await _stopTracking();
      _lastPingPosition = null;
      _lastPingAt = null;
      // Set immediately so the banner flips to "finished for today" on this
      // frame, rather than only after the next rebuild re-reads it.
      _closedToday = true;
      return null;
    });
  }
}

final workdayControllerProvider =
    AsyncNotifierProvider<WorkdayController, WorkdaySession?>(
  WorkdayController.new,
);
