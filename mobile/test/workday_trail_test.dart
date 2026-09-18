// The workday trail must never ask Android for a foreground service while the
// app is in the background, and must repair itself when the app comes forward.
//
// Sentry FLUTTER-C: 89 `Service.startForeground() not allowed` fatals off two
// handsets, every one with the app backgrounded, and none of them visible to
// the app because Flutter reports a refused `listen` through `FlutterError`
// rather than through the stream. These tests pin the behaviour that stops it
// at the source, without a platform channel: the lifecycle is a function, the
// stream is a controller, and the clock is a variable.

import 'dart:async';
import 'dart:ui' show AppLifecycleState;

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:gf_merch_rep/core/location_tracking.dart';
import 'package:gf_merch_rep/features/workday/workday_trail.dart';

Position fix(int minute) => Position(
  latitude: -24.65,
  longitude: 25.91,
  timestamp: DateTime.utc(2026, 9, 18, 8, minute),
  accuracy: 20,
  altitude: 1000,
  altitudeAccuracy: 5,
  heading: 0,
  headingAccuracy: 0,
  speed: 0,
  speedAccuracy: 0,
);

/// A trail wired to fakes. [opened] counts every `listen`, which is the thing
/// FLUTTER-C is about: one too many, in the wrong state.
class Harness {
  Harness({
    this.lifecycle = AppLifecycleState.resumed,
    this.mode = LocationTrackingMode.background,
    this.cancelGate,
  }) {
    trail = WorkdayTrail(
      currentMode: () async => mode,
      openStream: (_) {
        // Single-subscription on purpose: its `cancel()` waits for the
        // `onCancel` future, as the platform channel's does, so the gate can
        // hold a cancel open. A broadcast controller's would return at once.
        controller = StreamController<Position>(
          onListen: () => opened++,
          onCancel: () async {
            cancelled++;
            // A cancel on the Android side is a channel round trip; the gate
            // lets a test hold one open and land something else meanwhile.
            await cancelGate?.future;
          },
        );
        return controller!.stream;
      },
      lifecycleState: () => lifecycle,
      now: () => now,
    );
  }

  late final WorkdayTrail trail;
  final Completer<void>? cancelGate;
  AppLifecycleState? lifecycle;
  LocationTrackingMode mode;
  DateTime now = DateTime(2026, 9, 18, 8, 0);
  StreamController<Position>? controller;
  int opened = 0;
  int cancelled = 0;
  final received = <Position>[];

  void attach() =>
      trail.attach(this, onPosition: received.add, onModeChanged: () {});

  /// Goes to the background, then comes forward, the way a rep pocketing the
  /// phone and taking it out again does.
  Future<void> background() async {
    lifecycle = AppLifecycleState.paused;
    trail.didChangeLifecycle(AppLifecycleState.inactive);
    trail.didChangeLifecycle(AppLifecycleState.hidden);
    trail.didChangeLifecycle(AppLifecycleState.paused);
    await Future<void>.delayed(Duration.zero);
  }

  Future<void> foreground() async {
    lifecycle = AppLifecycleState.resumed;
    trail.didChangeLifecycle(AppLifecycleState.resumed);
    // Let the start's awaits run.
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  group('canStartTrail', () {
    test('a visible app may start the service', () {
      expect(canStartTrail(AppLifecycleState.resumed), isTrue);
      expect(canStartTrail(AppLifecycleState.inactive), isTrue);
    });

    test('a backgrounded app may not', () {
      expect(canStartTrail(AppLifecycleState.hidden), isFalse);
      expect(canStartTrail(AppLifecycleState.paused), isFalse);
      expect(canStartTrail(AppLifecycleState.detached), isFalse);
    });

    test('before the first lifecycle message, a cold start goes ahead', () {
      expect(canStartTrail(null), isTrue);
    });
  });

  group('trailLooksStalled', () {
    final start = DateTime(2026, 9, 18, 8, 0);

    test('the threshold is two sampling intervals', () {
      expect(kTrailStallAfter, kLocationPingInterval * 2);
    });

    test('a trail that has just started is not stalled', () {
      expect(
        trailLooksStalled(
          now: start.add(const Duration(minutes: 3)),
          startedAt: start,
        ),
        isFalse,
      );
    });

    test('no fix since the start, past the threshold, is stalled', () {
      expect(
        trailLooksStalled(
          now: start.add(const Duration(minutes: 11)),
          startedAt: start,
        ),
        isTrue,
      );
    });

    test('a recent fix keeps an old trail alive', () {
      expect(
        trailLooksStalled(
          now: start.add(const Duration(hours: 3)),
          startedAt: start,
          lastPositionAt: start.add(const Duration(hours: 2, minutes: 55)),
        ),
        isFalse,
      );
    });

    test('exactly on the threshold is not yet stalled', () {
      expect(
        trailLooksStalled(now: start.add(kTrailStallAfter), startedAt: start),
        isFalse,
      );
    });
  });

  group('WorkdayTrail', () {
    test('starts in the foreground and delivers positions', () async {
      final h = Harness()..attach();
      await h.trail.ensureRunning(reason: 'test');

      expect(h.trail.isRunning, isTrue);
      expect(h.opened, 1);

      h.controller!.add(fix(5));
      await Future<void>.delayed(Duration.zero);
      expect(h.received, hasLength(1));
      expect(h.trail.mode, LocationTrackingMode.background);
    });

    test(
      'a start asked for in the background waits for the foreground',
      () async {
        final h = Harness(lifecycle: AppLifecycleState.paused)..attach();
        await h.trail.ensureRunning(reason: 'build');

        // The whole of FLUTTER-C: no listen while backgrounded.
        expect(h.opened, 0);
        expect(h.trail.isRunning, isFalse);
        expect(h.trail.isDeferred, isTrue);
        expect(h.trail.isWanted, isTrue);

        await h.foreground();
        expect(h.opened, 1);
        expect(h.trail.isRunning, isTrue);
        expect(h.trail.isDeferred, isFalse);
      },
    );

    test('ensuring a running trail leaves it alone', () async {
      final h = Harness()..attach();
      await h.trail.ensureRunning(reason: 'start');
      await h.trail.ensureRunning(reason: 'build');
      await h.trail.ensureRunning(reason: 'build');

      // The old controller re-listened on every rebuild. One is the number.
      expect(h.opened, 1);
      expect(h.cancelled, 0);
    });

    test(
      'stopping cancels, and coming forward afterwards does not restart',
      () async {
        final h = Harness()..attach();
        await h.trail.ensureRunning(reason: 'start');
        await h.trail.stop(reason: 'end');

        expect(h.trail.isRunning, isFalse);
        expect(h.cancelled, 1);

        await h.background();
        await h.foreground();
        expect(h.opened, 1);
        expect(h.trail.isRunning, isFalse);
      },
    );

    test('a trail that went quiet is restarted on resume', () async {
      final h = Harness()..attach();
      await h.trail.ensureRunning(reason: 'start');
      h.controller!.add(fix(1));
      await Future<void>.delayed(Duration.zero);

      // Pocketed for an hour with nothing arriving: the service was refused
      // or suspended, and the subscription is a dead object.
      await h.background();
      h.now = h.now.add(const Duration(hours: 1));
      await h.foreground();

      expect(h.cancelled, 1);
      expect(h.opened, 2);
      expect(h.trail.isRunning, isTrue);
    });

    test('a trail still delivering is not restarted on resume', () async {
      final h = Harness()..attach();
      await h.trail.ensureRunning(reason: 'start');

      await h.background();
      h.now = h.now.add(const Duration(minutes: 30));
      // The foreground service kept sampling while backgrounded, as it
      // should with "Allow all the time".
      h.controller!.add(fix(29));
      await Future<void>.delayed(Duration.zero);
      await h.foreground();

      expect(h.opened, 1);
      expect(h.cancelled, 0);
    });

    test('a stop that lands during a start wins', () async {
      final h = Harness()..attach();
      final starting = h.trail.ensureRunning(reason: 'start');
      await h.trail.stop(reason: 'end');
      await starting;

      expect(h.trail.isRunning, isFalse);
      // Whatever was opened has been closed again: no stray service.
      expect(h.opened, h.cancelled);
    });

    // CodeRabbit on #61: `restart` awaits its cancel, then `_start` claims a
    // fresh generation — so a stop that landed during the cancel was not
    // seen, and the day ended with the service still sampling.
    test('a stop that lands during a restart wins', () async {
      final gate = Completer<void>();
      final h = Harness(cancelGate: gate)..attach();
      await h.trail.ensureRunning(reason: 'start');

      final restarting = h.trail.restart(reason: 'resume-stalled');
      await Future<void>.delayed(Duration.zero);
      final stopping = h.trail.stop(reason: 'end');
      gate.complete();
      await restarting;
      await stopping;

      expect(h.trail.isRunning, isFalse);
      expect(h.trail.isWanted, isFalse);
      expect(h.opened, 1);
      expect(h.cancelled, 1);
    });

    test('the newest owner keeps receiving after a stale detach', () async {
      final h = Harness()..attach();
      await h.trail.ensureRunning(reason: 'start');

      // Riverpod recreates the controller: the replacement attaches, then the
      // old instance's dispose runs. The old detach must not unhook the new.
      final replacement = <Position>[];
      final newOwner = Object();
      h.trail.attach(
        newOwner,
        onPosition: replacement.add,
        onModeChanged: () {},
      );
      h.trail.detach(h);

      h.controller!.add(fix(7));
      await Future<void>.delayed(Duration.zero);
      expect(replacement, hasLength(1));
      expect(h.received, isEmpty);
    });

    test('nothing is opened when tracking is unavailable', () async {
      final h = Harness(mode: LocationTrackingMode.unavailable)..attach();
      // The real opener returns null for `unavailable`; mirror that.
      final trail = WorkdayTrail(
        currentMode: () async => LocationTrackingMode.unavailable,
        openStream: (mode) => mode == LocationTrackingMode.unavailable
            ? null
            : h.controller?.stream,
        lifecycleState: () => AppLifecycleState.resumed,
      );
      await trail.ensureRunning(reason: 'start');
      expect(trail.isRunning, isFalse);
      expect(trail.mode, LocationTrackingMode.unavailable);
    });
  });
}
