import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/location_tracking.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/route_visit.dart';
import 'workday_controller.dart';
import 'workday_summary_screen.dart';

/// Start/End workday control shown at the top of today's route, with live
/// elapsed time and accumulated mileage while a workday is open.
class WorkdayBanner extends ConsumerStatefulWidget {
  const WorkdayBanner({super.key});

  @override
  ConsumerState<WorkdayBanner> createState() => _WorkdayBannerState();
}

class _WorkdayBannerState extends ConsumerState<WorkdayBanner> {
  Timer? _tick;

  /// True only while a start/end the user actually triggered is in flight.
  /// Distinguishes a real action from the provider's initial load, which
  /// would otherwise render as "Starting…" before any tap.
  bool _pending = false;

  @override
  void initState() {
    super.initState();
    // Repaint once a minute so the elapsed clock stays current.
    _tick = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  /// What the banner promises, matched to what the grant actually permits.
  ///
  /// This read "every 20 min" long after the interval became five, which is the
  /// kind of stale copy nobody notices because it is never wrong *enough* — but
  /// a rep reading it has been told something untrue about their own phone.
  String _trackingLine(LocationTrackingMode mode) {
    switch (mode) {
      case LocationTrackingMode.background:
        return 'Recording your route every 5 min';
      case LocationTrackingMode.foregroundOnly:
        return 'Only recording while this app is open';
      case LocationTrackingMode.unavailable:
        // Covers services switched off *and* permission denied. Naming only one
        // sends half of the reps to the wrong screen looking for the wrong
        // switch.
        return 'Not recording your route';
    }
  }

  String _formatElapsed(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }

  Future<void> _confirmEnd() async {
    final session = ref.read(workdayControllerProvider).value;
    if (session == null) return;

    // Today's list at this moment: how much of the schedule is done, what's
    // still open. Cached data, so this works offline too.
    final routes = ref.read(todayRoutesProvider).value ?? const <RouteVisit>[];
    final scheduled = routes.where((r) => !r.isUnscheduled).toList();
    final scheduledDone = scheduled.where((r) => r.isCheckedOut).length;
    final unscheduledDone =
        routes.where((r) => r.isUnscheduled && r.isCheckedOut).length;
    // An unscheduled visit that was never checked in is just an intention the
    // rep abandoned — it shouldn't nag at the end of the day. Scheduled stops
    // and any visit actually started still count as unfinished.
    final unfinished = routes
        .where((r) =>
            !r.isCheckedOut &&
            !r.isMissed &&
            !(r.isUnscheduled && !r.isCheckedIn))
        .toList();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => unfinished.isEmpty
          ? AlertDialog(
              title: const Text('End workday?'),
              content: const Text(
                'This stops location tracking and records your total hours '
                'and distance for the day.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('End workday'),
                ),
              ],
            )
          // Stores still open — make ending an explicit choice, not a slip.
          : AlertDialog(
              title: const Text('Finish your route first?'),
              content: Text(
                unfinished.length == 1
                    ? '${unfinished.first.storeName} isn\'t completed yet. '
                        'Are you sure you want to end your workday without '
                        'finishing it?'
                    : '${unfinished.length} stores on your list aren\'t '
                        'completed yet. Are you sure you want to end your '
                        'workday without finishing them?',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text(
                    'End anyway',
                    style: TextStyle(color: AppColors.danger),
                  ),
                ),
                ElevatedButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Keep working'),
                ),
              ],
            ),
    );
    if (confirmed != true) return;

    // Snapshot before ending — endWorkday clears the session.
    final summary = WorkdaySummaryData(
      elapsed: session.elapsed,
      distanceKm: session.distanceKm,
      completedToday: scheduledDone,
      scheduledToday: scheduled.length,
      unscheduledDone: unscheduledDone,
    );

    setState(() => _pending = true);
    await ref.read(workdayControllerProvider.notifier).endWorkday();
    if (!mounted) return;
    setState(() => _pending = false);

    // Ending failed (e.g. no GPS fix and no fallback) — the error listener
    // already surfaced it; don't celebrate a day that didn't close.
    if (ref.read(workdayControllerProvider).value != null) return;

    context.push('/workday-summary', extra: summary);
  }

  Future<void> _start() async {
    setState(() => _pending = true);
    await ref.read(workdayControllerProvider.notifier).startWorkday();
    if (!mounted) return;
    setState(() => _pending = false);

    // Day started — show the plan for the day ahead. Skip when the start
    // failed (no session), which the error listener has already surfaced.
    if (ref.read(workdayControllerProvider).value != null) {
      context.push('/day-plan');
    }
  }

  @override
  Widget build(BuildContext context) {
    final workdayAsync = ref.watch(workdayControllerProvider);

    ref.listen(workdayControllerProvider, (prev, next) {
      if (next.hasError) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text('${next.error}')));
      }
    });

    final session = workdayAsync.value;
    final active = session != null;
    // The rep has already closed today's day. Distinct from "not started":
    // there is nothing to start until tomorrow.
    final finishedForToday = !active &&
        ref.watch(workdayControllerProvider.notifier).isClosedForToday;
    // Only the user's own start/end shows a busy label; the provider's first
    // load just disables the button briefly.
    final isLoading = _pending;
    // How much of the trail this rep's grant actually allows. Exposed by the
    // controller since the location-stream change and, until now, read by
    // nothing — so a rep on a partial grant was tracked partially and never told.
    final trackingMode =
        ref.watch(workdayControllerProvider.notifier).trackingMode;
    final initialising = workdayAsync.isLoading && !_pending;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: active ? AppColors.success : AppColors.border,
          width: active ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: (active ? AppColors.success : AppColors.textMuted)
                      .withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  active
                      ? Icons.play_circle_fill
                      : finishedForToday
                          ? Icons.check_circle
                          : Icons.schedule,
                  color: active || finishedForToday
                      ? AppColors.success
                      : AppColors.textMuted,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      active
                          ? 'Workday in progress'
                          : finishedForToday
                              ? 'Workday complete'
                              : 'Workday not started',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14.5,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      active
                          ? _trackingLine(trackingMode)
                          : finishedForToday
                              ? 'You have finished for today. Your next '
                                  'workday can be started tomorrow.'
                              : 'Start your day to begin tracking',
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 12.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          // A partial grant is worth interrupting for. Without this the rep sees
          // "Workday in progress", believes they are covered, and the gap only
          // surfaces days later as a patchy trail nobody can explain.
          if (active && trackingMode != LocationTrackingMode.background) ...[
            const SizedBox(height: 12),
            _PermissionNotice(mode: trackingMode),
          ],
          if (active) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _Metric(
                    icon: Icons.timer_outlined,
                    label: 'Time worked',
                    value: _formatElapsed(session.elapsed),
                  ),
                ),
                Container(width: 1, height: 34, color: AppColors.border),
                Expanded(
                  child: _Metric(
                    icon: Icons.directions_car_outlined,
                    label: 'Distance',
                    value: '${session.distanceKm.toStringAsFixed(1)} km',
                  ),
                ),
              ],
            ),
          ],
          // No button at all once the day is closed. A disabled Start button
          // reads as "broken", and there is nothing the rep can do about it
          // until tomorrow — the message above is the whole answer.
          if (!finishedForToday) ...[
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: active
                ? OutlinedButton.icon(
                    onPressed: (isLoading || initialising) ? null : _confirmEnd,
                    icon: const Icon(Icons.stop_circle_outlined, size: 18),
                    label: const Text('End workday'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      side: const BorderSide(color: AppColors.danger),
                    ),
                  )
                : ElevatedButton.icon(
                    onPressed: (isLoading || initialising) ? null : _start,
                    icon: isLoading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor:
                                  AlwaysStoppedAnimation<Color>(Colors.white),
                            ),
                          )
                        : const Icon(Icons.play_arrow_rounded, size: 20),
                    label: Text(isLoading ? 'Starting…' : 'Start workday'),
                  ),
          ),
          ],
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 15, color: AppColors.textMuted),
            const SizedBox(width: 5),
            Text(
              label,
              style: const TextStyle(
                color: AppColors.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.bold,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}

/// Says what is missing and opens the one screen that can fix it.
///
/// `LocationTracking.openPermissionSettings` has existed since the location
/// stream landed and was wired to nothing, so the only route to "Allow all the
/// time" was a rep knowing their way around Android settings. On Android 11 and
/// later that grant *cannot* be requested from inside the app — the request
/// returns "while in use" with no dialog shown, which looks like a broken
/// button — so sending them to the system screen is the only honest option.
class _PermissionNotice extends StatelessWidget {
  const _PermissionNotice({required this.mode});

  final LocationTrackingMode mode;

  @override
  Widget build(BuildContext context) {
    // `unavailable` is two different situations wearing one name — location
    // services switched off, and permission denied or permanently denied. The
    // enum does not tell them apart, so the copy must not pretend to: it names
    // both and sends the rep to the screen that fixes either.
    final off = mode == LocationTrackingMode.unavailable;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.warning_amber_rounded,
              size: 18, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  off
                      ? 'Your route is not being recorded'
                      : 'Your route stops recording in the background',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  off
                      ? 'Location is switched off, or this app has not been '
                          'given permission. Open settings to turn it on.'
                      : 'Set location to "Allow all the time" so your route '
                          'keeps recording when the app is not open.',
                  style: const TextStyle(
                      color: AppColors.textMuted, fontSize: 12.5),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => LocationTracking.openPermissionSettings(),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 6),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('Open settings'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
