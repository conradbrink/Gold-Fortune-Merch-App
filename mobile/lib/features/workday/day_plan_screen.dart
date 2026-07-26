import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/route_visit.dart';
import 'workday_summary_screen.dart' show kMonthlyRewardTarget;

/// Shown once right after the rep starts their workday: the day ahead at a
/// glance — every stop with its time slot — plus where they stand on the
/// monthly target while there's still a whole day to influence it.
///
/// Reads today's list and the cached monthly figure, so it renders offline.
class DayPlanScreen extends ConsumerWidget {
  const DayPlanScreen({super.key});

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routes = ref.watch(todayRoutesProvider).value ?? const <RouteVisit>[];
    final profile = ref.watch(profileProvider).value;
    final monthlyAsync = ref.watch(monthlyCompletionProvider);

    final pending = routes.where((r) => !r.isCheckedOut && !r.isMissed).length;
    final firstName = profile?.fullName?.split(' ').first;

    return Scaffold(
      backgroundColor: AppColors.navy,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 16),
                child: Column(
                  children: [
                    Container(
                      width: 92,
                      height: 92,
                      decoration: BoxDecoration(
                        color: AppColors.gold.withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.wb_sunny_outlined,
                        size: 46,
                        color: AppColors.gold,
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      firstName != null
                          ? '${_greeting()}, $firstName!'
                          : '${_greeting()}!',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      routes.isEmpty
                          ? 'Nothing is scheduled today. Use "Unscheduled '
                              'visit" if you\'re covering a store.'
                          : pending == 0
                              ? 'Everything on today\'s list is already done '
                                  '— a workday with a clear road ahead.'
                              : 'You have $pending store${pending == 1 ? '' : 's'} '
                                  'to visit today. Here\'s the plan:',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.75),
                        fontSize: 14.5,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 28),
                    if (routes.isNotEmpty)
                      _PlanCard(
                        children: [
                          for (var i = 0; i < routes.length; i++) ...[
                            if (i > 0) const Divider(height: 20),
                            _StopRow(index: i + 1, visit: routes[i]),
                          ],
                        ],
                      ),
                    const SizedBox(height: 16),
                    monthlyAsync.when(
                      loading: () => const SizedBox.shrink(),
                      error: (_, _) => const SizedBox.shrink(),
                      data: (monthly) {
                        if (monthly == null) return const SizedBox.shrink();
                        final onTrack =
                            monthly.fraction >= kMonthlyRewardTarget;
                        return _PlanCard(
                          children: [
                            Row(
                              children: [
                                Icon(
                                  onTrack
                                      ? Icons.workspace_premium
                                      : Icons.flag_outlined,
                                  size: 20,
                                  color: onTrack
                                      ? AppColors.gold
                                      : AppColors.navy,
                                ),
                                const SizedBox(width: 8),
                                const Expanded(
                                  child: Text(
                                    'This month so far',
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
                                        ? AppColors.gold
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
                                    AppColors.navy.withValues(alpha: 0.08),
                                valueColor: AlwaysStoppedAnimation<Color>(
                                  onTrack ? AppColors.gold : AppColors.navy,
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              onTrack
                                  ? 'Great pace — stay above 90% to earn '
                                      'this month\'s reward.'
                                  : 'Finish today\'s stops to move toward '
                                      'the 90% monthly reward.',
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
                    backgroundColor: AppColors.gold,
                    foregroundColor: AppColors.navy,
                  ),
                  child: Text(
                    routes.isEmpty ? 'Got it' : "Let's go",
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w700),
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

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.children});
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

class _StopRow extends StatelessWidget {
  const _StopRow({required this.index, required this.visit});

  final int index;
  final RouteVisit visit;

  @override
  Widget build(BuildContext context) {
    final timeFormat = DateFormat.jm();
    final slot = visit.scheduledStartAt != null
        ? '${timeFormat.format(visit.scheduledStartAt!)}'
            '${visit.scheduledEndAt != null ? ' – ${timeFormat.format(visit.scheduledEndAt!)}' : ''}'
        : 'Unscheduled';

    return Row(
      children: [
        Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: visit.isCheckedOut
                ? AppColors.success.withValues(alpha: 0.14)
                : AppColors.navy.withValues(alpha: 0.08),
            shape: BoxShape.circle,
          ),
          child: visit.isCheckedOut
              ? const Icon(Icons.check, size: 16, color: AppColors.success)
              : Text(
                  '$index',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                    color: AppColors.navy,
                  ),
                ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                visit.storeName,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                  color: AppColors.textPrimary,
                  decoration: visit.isCheckedOut
                      ? TextDecoration.lineThrough
                      : null,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                slot,
                style: const TextStyle(
                  color: AppColors.textMuted,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
