import 'dart:async';

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
    ref.onDispose(() => _pingSub?.cancel());

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
    await _pingSub?.cancel();
    _pingSub = null;

    _trackingMode = await LocationTracking.currentMode();
    final stream = LocationTracking.stream(_trackingMode);
    if (stream == null) {
      ref.notifyListeners();
      return;
    }

    _pingSub = stream.listen(
      _onPosition,
      // A stream error (services switched off mid-round, permission revoked)
      // must not tear down the day. Drop the subscription and leave the session
      // open — the rep can still check in and out, and the trail resumes if
      // they turn location back on and reopen the app.
      onError: (_) {},
      cancelOnError: false,
    );
    ref.notifyListeners();
  }

  /// Ends the subscription, which is what stops the foreground service and
  /// clears its notification. A rep who has finished for the day must not be
  /// left with a "Workday in progress" notice, or a service still sampling GPS.
  Future<void> _stopTracking() async {
    await _pingSub?.cancel();
    _pingSub = null;
  }

  /// One position from the stream, rate-limited into at most one written ping.
  ///
  /// The distance filter bounds *stationary* noise, not speed: a rep driving at
  /// 60 km/h clears the 75 m filter every four and a half seconds. Without this
  /// guard that is hundreds of rows an hour and an outbox that never drains on a
  /// weak connection.
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
