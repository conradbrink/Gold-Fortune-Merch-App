import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';
import '../../core/terms.dart';
import '../../core/theme.dart';

/// The share of the month's scheduled visits a rep must complete to earn the
/// monthly reward.
const kMonthlyRewardTarget = 0.9;

/// Snapshot handed over by the banner the moment the workday ends. Everything
/// here is local data, so the screen renders instantly and fully offline.
class WorkdaySummaryData {
  final Duration elapsed;
  final double distanceKm;

  /// Today's scheduled stores that were completed / scheduled in total.
  final int completedToday;
  final int scheduledToday;

  /// Unscheduled visits completed today — celebrated, but kept separate from
  /// the schedule numbers.
  final int unscheduledDone;

  const WorkdaySummaryData({
    required this.elapsed,
    required this.distanceKm,
    required this.completedToday,
    required this.scheduledToday,
    required this.unscheduledDone,
  });

  bool get scheduleComplete =>
      scheduledToday > 0 && completedToday >= scheduledToday;
}

/// Shown once after the rep ends their workday: how the day went, and — when
/// the whole schedule was covered — a bit of celebration plus progress toward
/// the monthly 90% reward.
class WorkdaySummaryScreen extends ConsumerWidget {
  const WorkdaySummaryScreen({super.key, required this.data});

  final WorkdaySummaryData data;

  String _formatElapsed(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final allDone = data.scheduleComplete;
    final monthlyAsync = ref.watch(monthlyCompletionProvider);
    final t = ref.watch(termsProvider);

    return Scaffold(
      backgroundColor: context.brand.primary,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 16),
                child: Column(
                  children: [
                    // --- Hero -------------------------------------------
                    Container(
                      width: 92,
                      height: 92,
                      decoration: BoxDecoration(
                        color: (allDone ? context.brand.accent : Colors.white)
                            .withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        allDone
                            ? Icons.emoji_events_outlined
                            : Icons.nightlight_outlined,
                        size: 46,
                        color: allDone ? context.brand.accent : Colors.white,
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      allDone ? 'Well done!' : '${t.workday.one} ended',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      allDone
                          ? 'You completed every ${t.site.oneLower} on '
                              '${lower(t.dayPlan.one)}. Keep this up!'
                          : 'Your hours and mileage are saved. See you '
                              'tomorrow.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.75),
                        fontSize: 14.5,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 28),

                    // --- Day stats --------------------------------------
                    _SummaryCard(
                      children: [
                        _StatRow(
                          icon: Icons.timer_outlined,
                          label: 'Time worked',
                          value: _formatElapsed(data.elapsed),
                        ),
                        const Divider(height: 22),
                        _StatRow(
                          icon: Icons.directions_car_outlined,
                          label: 'Distance travelled',
                          value: '${data.distanceKm.toStringAsFixed(1)} km',
                        ),
                        const Divider(height: 22),
                        _StatRow(
                          icon: Icons.storefront_outlined,
                          label: 'Scheduled ${t.site.manyLower} visited',
                          value: data.scheduledToday > 0
                              ? '${data.completedToday} of ${data.scheduledToday}'
                              : 'None scheduled',
                          valueColor: allDone ? AppColors.success : null,
                        ),
                        if (data.unscheduledDone > 0) ...[
                          const Divider(height: 22),
                          _StatRow(
                            icon: Icons.add_business_outlined,
                            label: 'Extra unscheduled ${t.job.manyLower}',
                            value: '+${data.unscheduledDone}',
                            valueColor: context.brand.accent,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 16),

                    // --- Monthly reward progress ------------------------
                    monthlyAsync.when(
                      loading: () => const _SummaryCard(
                        children: [
                          Center(
                            child: Padding(
                              padding: EdgeInsets.symmetric(vertical: 8),
                              child: SizedBox(
                                width: 20,
                                height: 20,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              ),
                            ),
                          ),
                        ],
                      ),
                      // Offline with nothing cached — just skip the section.
                      error: (_, _) => const SizedBox.shrink(),
                      data: (monthly) {
                        if (monthly == null) return const SizedBox.shrink();
                        final onTrack =
                            monthly.fraction >= kMonthlyRewardTarget;
                        return _SummaryCard(
                          children: [
                            Row(
                              children: [
                                Icon(
                                  onTrack
                                      ? Icons.workspace_premium
                                      : Icons.flag_outlined,
                                  size: 20,
                                  color: onTrack
                                      ? context.brand.accent
                                      : context.brand.primary,
                                ),
                                const SizedBox(width: 8),
                                const Expanded(
                                  child: Text(
                                    'This month',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14.5,
                                      color: AppColors.textPrimary,
                                    ),
                                  ),
                                ),
                                Text(
                                  '${monthly.percent}%',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 16,
                                    color: onTrack
                                        ? context.brand.accent
                                        : AppColors.textPrimary,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: LinearProgressIndicator(
                                value: monthly.fraction,
                                minHeight: 8,
                                backgroundColor:
                                    context.brand.primary.withValues(alpha: 0.08),
                                valueColor: AlwaysStoppedAnimation<Color>(
                                  onTrack
                                      ? context.brand.accent
                                      : context.brand.primary,
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              onTrack
                                  ? "You're on track for this month's reward "
                                      '— ${monthly.completed} of '
                                      '${monthly.total} scheduled '
                                      '${t.job.manyLower} '
                                      'completed. Keep it above 90%!'
                                  : 'Complete 90% of your scheduled '
                                      '${t.job.manyLower} '
                                      'this month to earn the monthly reward '
                                      '(${monthly.completed} of '
                                      '${monthly.total} so far).',
                              style: const TextStyle(
                                color: AppColors.textMuted,
                                fontSize: 12.5,
                                height: 1.4,
                              ),
                            ),
                          ],
                        );
                      },
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
              child: SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  onPressed: () => context.go('/'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: context.brand.accent,
                    foregroundColor: context.brand.primary,
                  ),
                  child: const Text(
                    'Done',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({
    required this.icon,
    required this.label,
    required this.value,
    this.valueColor,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 19, color: AppColors.textMuted),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              color: AppColors.textMuted,
              fontSize: 13.5,
            ),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 15.5,
            fontWeight: FontWeight.bold,
            color: valueColor ?? AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}
