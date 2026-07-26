import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import 'workday_controller.dart';

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

  String _formatElapsed(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }

  Future<void> _confirmEnd() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('End workday?'),
        content: const Text(
          'This stops location tracking and records your total hours and '
          'distance for the day.',
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
      ),
    );
    if (confirmed == true) {
      setState(() => _pending = true);
      await ref.read(workdayControllerProvider.notifier).endWorkday();
      if (mounted) setState(() => _pending = false);
    }
  }

  Future<void> _start() async {
    setState(() => _pending = true);
    await ref.read(workdayControllerProvider.notifier).startWorkday();
    if (mounted) setState(() => _pending = false);
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
    // Only the user's own start/end shows a busy label; the provider's first
    // load just disables the button briefly.
    final isLoading = _pending;
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
                  active ? Icons.play_circle_fill : Icons.schedule,
                  color: active ? AppColors.success : AppColors.textMuted,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      active ? 'Workday in progress' : 'Workday not started',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14.5,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      active
                          ? 'Tracking your location every 20 min'
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
