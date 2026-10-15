import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';
import '../../core/terms.dart';
import '../../core/theme.dart';
import '../../data/models/route_visit.dart';
import '../../data/models/store_reorder.dart';
import '../../shared/widgets/status_badge.dart';
import '../auth/auth_controller.dart';
import '../../shared/widgets/sync_banner.dart';
import '../workday/workday_banner.dart';

class RouteTodayScreen extends ConsumerWidget {
  const RouteTodayScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routesAsync = ref.watch(todayRoutesProvider);
    final profileAsync = ref.watch(profileProvider);
    final date = ref.watch(selectedRouteDateProvider);
    // Warm the form-template cache here rather than on the store screen: a rep
    // who opens the app in the depot and loses signal on the road would
    // otherwise reach the store with no forms to fill in.
    //
    // Only for modules the company has: a disabled module's data would come
    // back empty from the database anyway, and asking for it costs a request
    // on every open.
    final company = ref.watch(companyConfigValueProvider);
    final t = ref.watch(termsProvider);
    if (company.has('checklists_forms')) ref.watch(formTemplatesProvider);
    // Same reasoning for the store list, which the unscheduled-visit picker
    // needs and which is otherwise only fetched once that screen is opened.
    ref.watch(storesProvider);
    // And the orderable catalogue. A rep taking an order at a shop door has a
    // customer waiting; the products have to already be on the phone.
    if (company.has('distribution')) ref.watch(catalogueProductsProvider);
    // And when each store last ordered, which every stop below shows and the
    // store screen turns into a prompt.
    final reorder = company.has('distribution')
        ? ref.watch(storeReorderProvider).maybeWhen(
              data: (all) => all,
              orElse: () => const <String, StoreReorder>{},
            )
        : const <String, StoreReorder>{};
    // The phone's own record of the visits an order was taken on: right at
    // once and offline, where the list fetched from the server is behind until
    // the order syncs. Read once for the whole list.
    final taken = company.has('distribution')
        ? ref.watch(ordersTakenProvider).maybeWhen(data: (v) => v, orElse: () => const <String>{})
        : const <String>{};

    return Scaffold(
      appBar: AppBar(
        // The company's word for the day's list: "Today's Route", "Today's
        // Jobs". Title case is how this bar has always read.
        title: Text(title(t.dayPlan.one)),
        actions: [
          IconButton(
            icon: const Icon(Icons.folder_outlined),
            tooltip: 'Files',
            onPressed: () => context.go('/files'),
          ),
          // Badged rather than silent. A warning nobody has said they have seen
          // is the one thing on this screen that somebody else is waiting on,
          // and an icon that looks the same either way is how it goes unread.
          if (company.has('hr'))
            _MyHrAction(count: ref.watch(unacknowledgedWarningCountProvider)),
          if (company.has('warehouse'))
            _DeliveriesAction(
              count: ref.watch(outstandingDeliveryCountProvider),
            ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/unscheduled'),
        backgroundColor: context.brand.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_business_outlined),
        label: Text('Unscheduled ${t.job.oneLower}'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(todayRoutesProvider);
          ref.invalidate(storeReorderProvider);
          // The pull is also how a rep picks up a changed company setting
          // without restarting the app.
          ref.invalidate(companyConfigProvider);
        },
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Container(
                width: double.infinity,
                color: context.brand.primary,
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    profileAsync.when(
                      data: (p) => Text(
                        p?.fullName ?? p?.email ?? '',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      loading: () => const SizedBox.shrink(),
                      error: (_, _) => const SizedBox.shrink(),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      DateFormat('EEEE, MMMM d').format(date),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    routesAsync.maybeWhen(
                      data: (routes) => Text(
                        '${t.site.count(routes.length)} scheduled',
                        style: const TextStyle(color: Colors.white60, fontSize: 13),
                      ),
                      orElse: () => const SizedBox.shrink(),
                    ),
                  ],
                ),
              ),
            ),
            const SliverToBoxAdapter(child: SyncBanner()),
            const SliverToBoxAdapter(child: WorkdayBanner()),
            routesAsync.when(
              data: (routes) {
                if (routes.isEmpty) {
                  return SliverFillRemaining(
                    hasScrollBody: false,
                    child: _EmptyState(terms: t),
                  );
                }
                return SliverPadding(
                  padding: const EdgeInsets.all(16),
                  sliver: SliverList.separated(
                    itemCount: routes.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final visitId = routes[index].visitClientGeneratedId;
                      return _RouteCard(
                        routeVisit: routes[index],
                        reorder: reorder[routes[index].storeId],
                        orderTaken: visitId != null && taken.contains(visitId),
                      );
                    },
                  ),
                );
              },
              loading: () => const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, stack) => SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'Couldn\'t load ${lower(t.dayPlan.one)}.\n$error',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.textMuted),
                    ),
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

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.terms});

  final Terms terms;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.event_available_outlined, size: 48, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(
              'No ${terms.site.manyLower} scheduled for today',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Pull down to refresh once your manager assigns '
              '${terms.job.manyLower}.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _RouteCard extends StatelessWidget {
  const _RouteCard({required this.routeVisit, this.reorder, this.orderTaken = false});
  final RouteVisit routeVisit;

  /// An order was taken on this stop's visit, by this phone.
  final bool orderTaken;

  /// When this stop's store last ordered; null when the company does not sell
  /// or the list has not reached the phone, and the line is left out.
  final StoreReorder? reorder;

  @override
  Widget build(BuildContext context) {
    final timeFormat = DateFormat.jm();
    final timeRange = routeVisit.scheduledStartAt != null
        ? '${timeFormat.format(routeVisit.scheduledStartAt!)}'
            '${routeVisit.scheduledEndAt != null ? ' – ${timeFormat.format(routeVisit.scheduledEndAt!)}' : ''}'
        : null;

    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.go('/visit/${routeVisit.cacheKey}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: context.brand.accent.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.storefront_outlined, color: context.brand.primary),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      routeVisit.storeName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    if (routeVisit.storeAddress != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        [routeVisit.storeAddress, routeVisit.storeCity, routeVisit.storeState]
                            .where((s) => s != null && s.isNotEmpty)
                            .join(', '),
                        style: const TextStyle(color: AppColors.textMuted, fontSize: 12.5),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    if (reorder != null) ...[
                      const SizedBox(height: 6),
                      _LastOrderLine(reorder: reorder!, orderTaken: orderTaken),
                    ],
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        StatusBadge(status: routeVisit.status),
                        if (timeRange != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            timeRange,
                            style: const TextStyle(
                              color: AppColors.textMuted,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                        if (routeVisit.isUnscheduled) ...[
                          const SizedBox(width: 8),
                          Text(
                            'Unscheduled',
                            style: TextStyle(
                              color: context.brand.accent.withValues(alpha: 0.95),
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

/// One line on a stop: when the store last ordered, coloured by whether it is
/// due. On every stop rather than a badge on the due ones, because most stores
/// are due at any time and a badge on nearly every card would say nothing.
class _LastOrderLine extends StatelessWidget {
  const _LastOrderLine({required this.reorder, this.orderTaken = false});

  final StoreReorder reorder;
  final bool orderTaken;

  @override
  Widget build(BuildContext context) {
    final status = reorderStateOn(reorder, DateTime.now());
    final (color, text) = orderTaken
        ? (AppColors.success, 'Order taken today')
        : switch (status.state) {
      ReorderState.never => (AppColors.textMuted, 'No orders yet'),
      ReorderState.stopped =>
        (AppColors.danger, 'Last order ${daysAgo(status.daysSince!)}'),
      ReorderState.due =>
        (AppColors.warning, 'Last order ${daysAgo(status.daysSince!)}, due now'),
      ReorderState.dueSoon => (
          AppColors.textMuted,
          'Last order ${daysAgo(status.daysSince!)}, due in '
              '${status.daysUntilDue} ${status.daysUntilDue == 1 ? 'day' : 'days'}'
        ),
      ReorderState.notDue =>
        (AppColors.textMuted, 'Last order ${daysAgo(status.daysSince!)}'),
          };
    return Row(
      children: [
        Icon(Icons.receipt_long_outlined, size: 14, color: color),
        const SizedBox(width: 4),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              color: color == AppColors.textMuted ? AppColors.textMuted : AppColors.textPrimary,
              fontSize: 12.5,
              fontWeight: color == AppColors.textMuted ? FontWeight.w500 : FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// The entry point to the rep's own HR record, with a badge for anything on
/// their file they have not acknowledged.
///
/// The count is a `FutureProvider`, and a rep with no signal or no employee
/// record gets the plain icon rather than an error — the whole point of the
/// badge is the one case where there is something to say.
class _MyHrAction extends StatelessWidget {
  const _MyHrAction({required this.count});

  final AsyncValue<int> count;

  @override
  Widget build(BuildContext context) {
    final unread = count.maybeWhen(data: (n) => n, orElse: () => 0);
    final button = IconButton(
      icon: const Icon(Icons.event_available_outlined),
      tooltip: 'My leave and file',
      onPressed: () => context.go('/my-hr'),
    );
    if (unread == 0) return button;
    return Badge.count(
      count: unread,
      backgroundColor: context.brand.accent,
      textColor: context.brand.primaryDark,
      child: button,
    );
  }
}

/// Deliveries the warehouse has put this rep's name on, badged with how many
/// are still on the road.
class _DeliveriesAction extends StatelessWidget {
  const _DeliveriesAction({required this.count});

  final AsyncValue<int> count;

  @override
  Widget build(BuildContext context) {
    final outstanding = count.maybeWhen(data: (n) => n, orElse: () => 0);
    final button = IconButton(
      icon: const Icon(Icons.local_shipping_outlined),
      tooltip: 'My deliveries',
      onPressed: () => context.go('/deliveries'),
    );
    if (outstanding == 0) return button;
    return Badge.count(
      count: outstanding,
      backgroundColor: context.brand.accent,
      textColor: context.brand.primaryDark,
      child: button,
    );
  }
}
