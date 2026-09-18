import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/location_service.dart';
import '../../core/location_tracking.dart';
import '../../core/monitoring.dart';
import '../../core/providers.dart';
import '../../data/models/workday_session.dart';
import 'workday_auto_end.dart';
import 'workday_trail.dart';

export '../../core/location_tracking.dart'
    show kLocationPingInterval, LocationTrackingMode;

class WorkdayController extends AsyncNotifier<WorkdaySession?> {
  /// Names this instance to the trail. Riverpod 3 makes a new notifier on
  /// every rebuild, and the trail must know which one to stop listening to.
  final Object _token = Object();

  WorkdayTrail get _trail => ref.read(workdayTrailProvider);

  /// How much of the trail this rep's permissions actually allow.
  ///
  /// Read by the banner so a rep granting only "while using the app" is told
  /// their route stops recording when they put the phone away, rather than the
  /// manager discovering the gap a week later.
  LocationTrackingMode get trackingMode => _trail.mode;

  @override
  Future<WorkdaySession?> build() async {
    // Must outlive any one screen — navigating to a store shouldn't wipe the
    // active session or drop the location subscription.
    ref.keepAlive();

    // The subscription lives on the trail, not here, and this is why: this
    // method re-runs on every auth event, and the notifier is recreated with
    // it. When the subscription was a field of the notifier, every rebuild
    // cancelled it and opened another — in the background, where Android
    // refuses the foreground service, and where nothing could see the refusal
    // (FLUTTER-C). The trail keeps one subscription across all of that; a
    // controller only tells it who to deliver positions to.
    final trail = _trail;
    trail.attach(
      _token,
      onPosition: _onPosition,
      onModeChanged: () {
        if (ref.mounted) ref.notifyListeners();
      },
    );
    ref.onDispose(() {
      trail.detach(_token);
      _autoEndTimer?.cancel();
    });

    final user = ref.watch(currentUserProvider);
    if (user == null) {
      unawaited(trail.stop(reason: 'signed-out'));
      return null;
    }

    final repo = ref.read(workdayRepositoryProvider);
    final session = await repo.fetchActiveSession(user.id);

    if (session != null) {
      // Resubscribes after a cold start, so a rep whose phone was killed
      // mid-round starts recording again the moment the app is reopened — and
      // leaves a trail that is already running alone.
      unawaited(trail.ensureRunning(reason: 'build'));
      // And ends the day at 19:30 — at once, if a phone woken the next
      // morning is still holding yesterday open.
      _armAutoEnd(session);
    } else {
      unawaited(trail.stop(reason: 'no-open-day'));
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

  bool _autoEnded = false;

  /// True when today's day was ended by the 19:30 rule rather than by the
  /// rep, so the banner can say so instead of leaving them to wonder.
  bool get wasAutoEnded => _autoEnded;

  Timer? _autoEndTimer;

  /// Schedules the day to end itself at the cut-off in [workday_auto_end.dart].
  ///
  /// A timer on this instance, re-armed by every build: Riverpod recreates the
  /// controller on rebuild and `onDispose` cancels the old one, so there is
  /// never more than one. A `Timer` in a suspended isolate fires when the app
  /// comes forward, and a phone that was killed is caught by the next
  /// `build` — the wait is zero for a day already past its cut-off.
  void _armAutoEnd(WorkdaySession session) {
    _autoEndTimer?.cancel();
    _autoEndTimer = Timer(
      untilAutoEnd(now: DateTime.now(), startedAt: session.startedAt),
      () => unawaited(_autoEnd()),
    );
  }

  Future<void> _autoEnd() async {
    if (!ref.mounted) return;
    final session = state.value;
    if (session == null) return;
    // The clock can have moved under a long timer. Ask again rather than
    // trust that firing means due.
    if (!isPastAutoEnd(now: DateTime.now(), startedAt: session.startedAt)) {
      _armAutoEnd(session);
      return;
    }
    Monitoring.event('workday.auto_end');
    await endWorkday(automatic: true);
  }

  /// One position from the stream, rate-limited into at most one written ping.
  ///
  /// Sampling is time-based, so this is the *only* rate limit — the 75 m
  /// distance filter that used to bound a stationary rep is gone, and without
  /// [shouldRecordPing] every fix the platform produced would be written.
  Future<void> _onPosition(Position position) async {
    if (!ref.mounted) return;
    final trail = _trail;
    final now = DateTime.now();
    if (!shouldRecordPing(now: now, lastPingAt: trail.lastPingAt)) return;
    trail.lastPingAt = now;
    await _ping(position);
  }

  Future<void> _ping(Position position) async {
    final session = state.value;
    final profile = ref.read(profileProvider).value;
    if (session == null || profile == null) return;

    try {
      final trail = _trail;
      final repo = ref.read(workdayRepositoryProvider);
      final result = await repo.recordIntervalPing(
        orgId: profile.orgId,
        repId: profile.id,
        sessionClientId: session.clientGeneratedId,
        last: trail.lastPingPosition,
        position: position,
      );
      trail.lastPingPosition = result.position;
      // Mileage accrues locally so it stays correct with no connection, and
      // is cached so a restart mid-day doesn't reset the odometer.
      final updated = session.copyWith(
        distanceMeters: session.distanceMeters + result.legMeters,
      );
      await repo.cacheActiveSession(updated);
      if (ref.mounted) state = AsyncData(updated);
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
      final trail = _trail;
      trail.lastPingPosition = null;
      trail.lastPingAt = null;
      await trail.ensureRunning(reason: 'start');
      _autoEnded = false;
      _armAutoEnd(session);
      return session;
    });
  }

  /// Ends the open day.
  ///
  /// [automatic] is the 19:30 rule: the day ends as of the cut-off, not now,
  /// with the last position the trail saw rather than a fresh fix — the phone
  /// may be in a pocket, and a fix it cannot get must not stop the day from
  /// ending. A rep pressing End gets the old behaviour: a fresh fix, and the
  /// location error surfaced if there is one.
  Future<void> endWorkday({bool automatic = false}) async {
    final profile = ref.read(profileProvider).value;
    final session = state.value;
    if (profile == null || session == null) return;
    _autoEndTimer?.cancel();

    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final trail = _trail;
      final repo = ref.read(workdayRepositoryProvider);
      await repo.endWorkday(
        orgId: profile.orgId,
        repId: profile.id,
        session: session,
        distanceMeters: session.distanceMeters,
        endedAt: automatic
            ? autoEndCutoffFor(session.startedAt)
            : DateTime.now(),
        position: automatic
            ? trail.lastPingPosition
            : await LocationService.getCurrentPosition(),
        automatic: automatic,
      );
      await trail.stop(reason: automatic ? 'auto-end' : 'end');
      trail.lastPingPosition = null;
      trail.lastPingAt = null;
      // Set immediately so the banner flips to "finished for today" on this
      // frame, rather than only after the next rebuild re-reads it.
      _closedToday = true;
      _autoEnded = automatic;
      return null;
    });
  }
}

final workdayControllerProvider =
    AsyncNotifierProvider<WorkdayController, WorkdaySession?>(
      WorkdayController.new,
    );
