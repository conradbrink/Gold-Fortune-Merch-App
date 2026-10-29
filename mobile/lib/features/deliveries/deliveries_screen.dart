import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/delivery.dart';
import '../../shared/widgets/message_panel.dart';

/// Deliveries the warehouse has put this rep's name on.
///
/// The gap this closes: stock left the building for a shop on this rep's round
/// and the only way they found out was somebody telling them, or the shop
/// asking where it was. A rep standing in an aisle being asked "did my order
/// come?" could not answer a question the system already knew the answer to.
///
/// A card opens the delivery (`DeliveryDetailScreen`): what is in it, where
/// it goes and who to ask for.
///
/// The drop itself is recorded on the delivery's own screen: the owner
/// decided (27 Oct 2026) that the driver records a full delivery there, with a
/// photo of the signed delivery note, through `delivery_confirm()`.
class DeliveriesScreen extends ConsumerWidget {
  const DeliveriesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final deliveries = ref.watch(myDeliveriesProvider);
    final site = ref.watch(termsProvider).site.oneLower;

    // A drop recorded on this phone has reached the server: the list and the
    // badge are asked again, so it moves to Finished.
    ref.listen(pendingDeliveryConfirmsProvider, (previous, next) {
      final before = previous?.value ?? const <String>{};
      final now = next.value ?? const <String>{};
      if (before.any((id) => !now.contains(id))) {
        ref.invalidate(myDeliveriesProvider);
        ref.invalidate(outstandingDeliveryCountProvider);
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('My deliveries')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(myDeliveriesProvider);
          // The badge on the home screen counts the same deliveries.
          ref.invalidate(outstandingDeliveryCountProvider);
        },
        child: deliveries.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => const MessagePanel(
            scrollable: true,
            icon: Icons.wifi_off_outlined,
            title: 'This needs a connection',
            body:
                'Deliveries are not kept on the phone — a list from yesterday '
                'would tell you the stock is on its way when it may not be.',
          ),
          data: (rows) {
            if (rows.isEmpty) {
              return MessagePanel(
                scrollable: true,
                icon: Icons.local_shipping_outlined,
                title: 'No deliveries assigned to you',
                body:
                    'When the warehouse puts your name on a consignment it '
                    'appears here, with the $site it is going to.',
              );
            }
            final outstanding = rows.where((d) => d.isOutstanding).toList();
            final done = rows.where((d) => !d.isOutstanding).toList();
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (outstanding.isNotEmpty) ...[
                  const SectionTitle('On the road'),
                  for (final d in outstanding) DeliveryCard(d),
                  const SizedBox(height: 20),
                ],
                if (done.isNotEmpty) ...[
                  const SectionTitle('Finished'),
                  for (final d in done) DeliveryCard(d),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The delivery's status as a coloured pill, on the list and on the delivery.
class DeliveryStatusChip extends StatelessWidget {
  const DeliveryStatusChip(this.status, {super.key});

  final String status;

  static const _colours = {
    'in_transit': AppColors.info,
    'delivered': AppColors.success,
    'failed': AppColors.danger,
    'returned': AppColors.warning,
  };

  @override
  Widget build(BuildContext context) {
    final colour = _colours[status] ?? AppColors.textMuted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: colour.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        status.replaceAll('_', ' '),
        style: TextStyle(
            color: colour, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// One delivery on a list. Opens it under [basePath]: a rep's are under
/// "My deliveries", a driver's under their own home. [stop] numbers it on a
/// planned round.
class DeliveryCard extends ConsumerWidget {
  const DeliveryCard(
    this.delivery, {
    super.key,
    this.basePath = '/deliveries',
    this.stop,
  });

  final Delivery delivery;
  final String basePath;
  final int? stop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = delivery;
    final fmt = DateFormat('d MMM');
    final waiting = d.isOutstanding &&
        (ref.watch(pendingDeliveryConfirmsProvider).value?.contains(d.id) ?? false);

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.go('$basePath/${d.id}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (stop != null) ...[
                    CircleAvatar(
                      radius: 13,
                      backgroundColor: context.brand.primary,
                      child: Text(
                        '$stop',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                  ],
                  Expanded(
                    child: Text(
                      d.storeName,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 15),
                    ),
                  ),
                  DeliveryStatusChip(d.status),
                  const Icon(Icons.chevron_right, color: AppColors.textMuted),
                ],
              ),
              if (d.storeAddress != null) ...[
                const SizedBox(height: 2),
                Text(
                  d.storeAddress!,
                  style:
                      const TextStyle(color: AppColors.textMuted, fontSize: 12),
                ),
              ],
              const SizedBox(height: 10),
              Text(
                // Units and lines; the names are on the delivery it opens.
                '${d.units} ${d.units == 1 ? 'unit' : 'units'} · '
                '${d.lineCount} ${d.lineCount == 1 ? 'line' : 'lines'} · '
                'order ${d.orderNumber}',
                style: const TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 6),
              Text(
                [
                  'Left ${fmt.format(d.dispatchedAt)}',
                  if (d.expectedOn != null && d.isOutstanding)
                    'due ${fmt.format(d.expectedOn!)}',
                  if (d.deliveredAt != null)
                    'arrived ${fmt.format(d.deliveredAt!)}',
                  if (d.carrier != null) d.carrier!,
                ].join(' · '),
                style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
              ),
              if (waiting) ...[
                const SizedBox(height: 6),
                Text(
                  'You recorded it as delivered. Waiting for signal to send it.',
                  style: TextStyle(
                    color: context.brand.primary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              if (d.trackingReference != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    'Tracking ${d.trackingReference}',
                    style: const TextStyle(
                        color: AppColors.textMuted, fontSize: 11),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  d.dispatchNumber,
                  style: const TextStyle(
                      color: AppColors.textMuted,
                      fontSize: 11,
                      letterSpacing: 0.4),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
