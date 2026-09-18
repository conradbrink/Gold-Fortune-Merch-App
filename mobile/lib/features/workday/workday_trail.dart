import 'dart:async';
import 'dart:ui' show AppLifecycleState;

import 'package:flutter/widgets.dart' show AppLifecycleListener, WidgetsBinding;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/location_tracking.dart';
import '../../core/monitoring.dart';

typedef TrackingModeReader = Future<LocationTrackingMode> Function();
typedef TrailStreamOpener =
    Stream<Position>? Function(LocationTrackingMode mode);

/// The workday's position subscription, owned for as long as the app runs.
///
/// ## Why this is not on the controller
///
/// It used to be. Riverpod 3 recreates a notifier every time its provider
/// rebuilds, and `WorkdayController.build` watches the current user — so
/// every auth event tore the subscription down with the old instance and
/// opened a new one with the new. In the foreground that was churn; in the
/// background it was the whole of FLUTTER-C: the fresh `listen` asked Android
/// for a foreground service from a backgrounded process, Android refused, and
/// because Flutter's `EventChannel` reports a refused `listen` through
/// `FlutterError.reportError` rather than through the stream, nothing in the
/// app could see that the trail had died. It stayed dead until the next
/// rebuild happened to land in the foreground.
///
/// This object survives rebuilds. A controller *attaches* to it to receive
/// positions and *detaches* when disposed; the subscription itself is only
/// opened when there is no open one, only while the app is in the foreground
/// (see [canStartTrail]), and is repaired on resume when it has gone quiet
/// (see [trailLooksStalled]).
class WorkdayTrail {
  WorkdayTrail({
    this._currentMode = LocationTracking.currentMode,
    this._openStream = LocationTracking.stream,
    AppLifecycleState? Function()? lifecycleState,
    this._now = DateTime.now,
  }) : _lifecycleState = lifecycleState ?? _bindingLifecycleState;

  static AppLifecycleState? _bindingLifecycleState() =>
      WidgetsBinding.instance.lifecycleState;

  final TrackingModeReader _currentMode;
  final TrailStreamOpener _openStream;
  final AppLifecycleState? Function() _lifecycleState;
  final DateTime Function() _now;

  StreamSubscription<Position>? _sub;
  LocationTrackingMode _mode = LocationTrackingMode.unavailable;

  /// Whether a day is open and the trail should be running.
  bool _wanted = false;

  /// A start that was asked for while the app was not in the foreground, and
  /// is owed the moment it comes forward.
  bool _deferred = false;

  DateTime? _startedAt;
  DateTime? _lastPositionAt;

  /// Bumped by every start and every stop, so an in-flight start can tell
  /// that it has been overtaken. See [_start].
  int _generation = 0;

  /// When the last ping was *written* and where, to enforce `kMinPingSpacing`
  /// and measure the next leg. Kept here rather than on the controller for
  /// the reason the subscription is: the controller is rebuilt, this is not,
  /// and a reset rate limit on every rebuild is an extra row every time.
  DateTime? lastPingAt;
  Position? lastPingPosition;

  Object? _owner;
  void Function(Position position)? _onPosition;
  void Function()? _onModeChanged;

  /// How much of the trail the rep's grant allows, as last read.
  LocationTrackingMode get mode => _mode;

  bool get isRunning => _sub != null;
  bool get isWanted => _wanted;
  bool get isDeferred => _deferred;

  /// Routes positions and mode changes to [owner] until it detaches.
  ///
  /// One owner at a time, and the newest wins: a controller rebuilt by
  /// Riverpod attaches before or after its predecessor detaches, and either
  /// order has to leave the new one wired up.
  void attach(
    Object owner, {
    required void Function(Position position) onPosition,
    required void Function() onModeChanged,
  }) {
    _owner = owner;
    _onPosition = onPosition;
    _onModeChanged = onModeChanged;
  }

  /// Stops routing to [owner] — and only [owner], so a stale detach from a
  /// disposed controller cannot unhook the one that replaced it.
  void detach(Object owner) {
    if (!identical(_owner, owner)) return;
    _owner = null;
    _onPosition = null;
    _onModeChanged = null;
  }

  /// Makes sure the trail is running, or will run as soon as it may.
  ///
  /// Idempotent: a trail that is already open is left exactly as it is. That
  /// is the difference between this and the old controller, which cancelled
  /// and re-listened on every rebuild.
  Future<void> ensureRunning({required String reason}) async {
    _wanted = true;
    if (_sub != null) return;
    await _start(reason);
  }

  /// Ends the subscription, which is what stops the foreground service and
  /// clears its notification. A rep who has finished for the day must not be
  /// left with a "Workday in progress" notice, or a service still sampling.
  Future<void> stop({required String reason}) async {
    _wanted = false;
    _deferred = false;
    // Invalidate any start still in flight *before* awaiting, or it can finish
    // afterwards and hand back a subscription this stop was meant to prevent.
    _generation++;
    Monitoring.event('trail.stop', data: {'reason': reason});
    await _cancelCurrent();
  }

  /// Tears the subscription down and opens a fresh one.
  Future<void> restart({required String reason}) async {
    _generation++;
    await _cancelCurrent();
    await _start(reason);
  }

  /// Called on every app lifecycle change. Only coming forward matters.
  void didChangeLifecycle(AppLifecycleState state) {
    if (!_wanted || !canStartTrail(state)) return;
    if (_deferred || _sub == null) {
      unawaited(_start('resume'));
      return;
    }
    final startedAt = _startedAt;
    if (startedAt != null &&
        trailLooksStalled(
          now: _now(),
          startedAt: startedAt,
          lastPositionAt: _lastPositionAt,
        )) {
      unawaited(restart(reason: 'resume-stalled'));
    }
  }

  Future<void> _start(String reason) async {
    final lifecycle = _lifecycleState();
    if (!canStartTrail(lifecycle)) {
      _deferred = true;
      Monitoring.event(
        'trail.deferred',
        data: {'reason': reason, 'lifecycle': lifecycle?.name},
      );
      return;
    }
    _deferred = false;

    // Claim this attempt. `currentMode()` is a channel round trip, and a stop
    // can land while it is out — so a start begun before the day ended can
    // resume *after* everything has been cancelled, and assign a fresh
    // subscription with nobody left to own it. That subscription holds the
    // foreground service open. The token is what makes a start abandonable
    // partway through.
    final generation = ++_generation;
    bool superseded() => generation != _generation;

    await _cancelCurrent();
    if (superseded()) return;

    _setMode(await _currentMode());
    if (superseded()) return;

    // While `currentMode()` was out, an older start may have listened and,
    // finding itself superseded, queued its own cancel. Listening now would
    // overlap that cancel — the exact race this class exists to avoid — so
    // wait for the queue to drain, then ask once more whether this start is
    // still the one that matters.
    await (_cancelling ?? Future<void>.value());
    if (superseded()) return;

    // The awaits above are long enough for the app to have gone to the
    // background. Asking Android for the service now would be the refused
    // start all over again.
    final lifecycleNow = _lifecycleState();
    if (!canStartTrail(lifecycleNow)) {
      _deferred = true;
      Monitoring.event(
        'trail.deferred',
        data: {'reason': reason, 'lifecycle': lifecycleNow?.name},
      );
      return;
    }

    final stream = _openStream(_mode);
    if (stream == null) return;

    final sub = stream.listen(
      _handlePosition,
      // A stream error is how a mid-day revocation arrives: permission taken
      // away, or location services switched off, while the day is open.
      // Dropping it silently left the banner still promising "recording every
      // 5 min" after recording had stopped — the one thing the notice exists
      // to prevent.
      //
      // The subscription is deliberately *not* torn down: a transient fix
      // failure must not end the day, and `cancelOnError: false` keeps the
      // stream alive so it resumes if the rep restores the grant.
      // Synchronous, and the refresh fired from inside it. `Stream.listen`
      // does not await what `onError` returns, so an `async` callback that
      // throws becomes an unhandled asynchronous error and takes the zone
      // down. The work is started here and its failure caught there.
      onError: (_) {
        unawaited(_refreshMode());
      },
      cancelOnError: false,
    );

    // Listening is itself an await-free step, but a stop can have landed
    // while the stream was being built. Cancelling here rather than keeping
    // it is the difference between a stray service and none — and it goes
    // through the same queue as every other cancel, so the start that
    // superseded this one waits for it before listening.
    if (superseded()) {
      await _enqueueCancel(sub);
      return;
    }

    _sub = sub;
    _startedAt = _now();
    _lastPositionAt = null;
    // Breadcrumb, so the next Sentry event about the trail says what opened
    // it and in which state — the question the FLUTTER-C events could not
    // answer, because the async frames above a `listen` are not on its stack.
    Monitoring.event(
      'trail.start',
      data: {
        'reason': reason,
        'mode': _mode.name,
        'lifecycle': lifecycle?.name,
      },
    );
  }

  void _handlePosition(Position position) {
    _lastPositionAt = _now();
    _onPosition?.call(position);
  }

  void _setMode(LocationTrackingMode mode) {
    if (mode == _mode) return;
    _mode = mode;
    _onModeChanged?.call();
  }

  /// Re-reads the grant after the stream has complained.
  ///
  /// Its own failure is swallowed on purpose: not knowing the mode is no
  /// reason to end a rep's day, and the next error or restart asks again.
  Future<void> _refreshMode() async {
    try {
      _setMode(await _currentMode());
    } catch (_) {
      // Deliberately ignored — see above.
    }
  }

  /// The cancel still in flight, if any. See [_cancelCurrent].
  Future<void>? _cancelling;

  /// Releases the current subscription and waits for the platform to agree.
  ///
  /// Every caller awaits the *same* future. `_sub` is cleared synchronously
  /// so nothing else can grab the subscription, but a cancel on geolocator's
  /// Android side is a channel round trip, and a start that came in behind an
  /// earlier cancel used to find the field already null, skip straight past
  /// it, and open a new stream while the old one was still being torn down.
  /// Chaining onto the in-flight cancel means a replacement subscription is
  /// never created until the previous one has actually gone.
  Future<void> _cancelCurrent() {
    final sub = _sub;
    _sub = null;
    _startedAt = null;
    if (sub == null) return _cancelling ?? Future<void>.value();
    return _enqueueCancel(sub);
  }

  /// Appends one cancel to the queue and returns a future for the whole queue.
  Future<void> _enqueueCancel(StreamSubscription<Position> sub) {
    final previous = _cancelling ?? Future<void>.value();
    // Not caught: geolocator's cancel errors never arrive here. Flutter's
    // `EventChannel` reports a failed `cancel` through `FlutterError`, so the
    // `on PlatformException` that 1.1.8 wrapped around this was dead code —
    // five "No active stream to cancel" reports came off that build with it
    // in place. Those were the echo of a `listen` refused in the background,
    // which the lifecycle gate in [_start] now prevents at the source.
    final next = previous.then((_) => sub.cancel());
    _cancelling = next;
    return next.whenComplete(() {
      if (identical(_cancelling, next)) _cancelling = null;
    });
  }
}

/// One trail for the whole app. Kept alive: it must outlive any screen and
/// any rebuild of the controller that drives it.
final workdayTrailProvider = Provider<WorkdayTrail>((ref) {
  ref.keepAlive();
  final trail = WorkdayTrail();
  final lifecycle = AppLifecycleListener(
    onStateChange: trail.didChangeLifecycle,
  );
  ref.onDispose(() {
    lifecycle.dispose();
    unawaited(trail.stop(reason: 'dispose'));
  });
  return trail;
});
