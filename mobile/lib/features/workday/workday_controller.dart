import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/providers.dart';
import '../../data/models/workday_session.dart';

/// How often to sample the rep's location while a workday is open.
/// The brief asked for every 15–30 minutes; 20 balances trail fidelity
/// against battery drain.
const kLocationPingInterval = Duration(minutes: 20);

class WorkdayController extends AsyncNotifier<WorkdaySession?> {
  Timer? _pingTimer;
  Position? _lastPingPosition;

  @override
  Future<WorkdaySession?> build() async {
    // Must outlive any one screen — navigating to a store shouldn't wipe the
    // active session or stop the ping timer.
    ref.keepAlive();
    ref.onDispose(() => _pingTimer?.cancel());

    final user = ref.watch(currentUserProvider);
    if (user == null) {
      _pingTimer?.cancel();
      return null;
    }

    final repo = ref.read(workdayRepositoryProvider);
    final session = await repo.fetchActiveSession(user.id);

    if (session != null) {
      _startPingTimer();
    } else {
      _pingTimer?.cancel();
    }
    return session;
  }

  void _startPingTimer() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(kLocationPingInterval, (_) => _ping());
  }

  Future<void> _ping() async {
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
      // A single failed ping (no fix, permission revoked mid-day) must not
      // kill the timer — the next interval tries again.
    }
  }

  Future<void> startWorkday() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) return;

    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final repo = ref.read(workdayRepositoryProvider);
      final session = await repo.startWorkday(
        orgId: profile.orgId,
        repId: profile.id,
      );
      _lastPingPosition = null;
      _startPingTimer();
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
      _pingTimer?.cancel();
      _lastPingPosition = null;
      return null;
    });
  }
}

final workdayControllerProvider =
    AsyncNotifierProvider<WorkdayController, WorkdaySession?>(
  WorkdayController.new,
);
