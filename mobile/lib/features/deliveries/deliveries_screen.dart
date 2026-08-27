import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/delivery.dart';

/// Deliveries the warehouse has put this rep's name on.
///
/// The gap this closes: stock left the building for a shop on this rep's round
/// and the only way they found out was somebody telling them, or the shop
/// asking where it was. A rep standing in an aisle being asked "did my order
/// come?" could not answer a question the system already knew the answer to.
///
/// Read-only, on purpose for now. Recording a delivery moves stock out of the
/// in-transit location, closes the order and files the proof — one transaction
/// with an audit trail behind it, and a second way into that from a handset is
/// not something to add without deciding it deliberately.
class DeliveriesScreen extends ConsumerWidget {
  const DeliveriesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final deliveries = ref.watch(myDeliveriesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('My deliveries')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(myDeliveriesProvider),
        child: deliveries.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => ListView(children: const [
            SizedBox(height: 80),
            _Empty(
              icon: Icons.wifi_off_outlined,
              title: 'This needs a connection',
              body:
                  'Deliveries are not kept on the phone — a list from yesterday '
                  'would tell you the stock is on its way when it may not be.',
            ),
          ]),
          data: (rows) {
            if (rows.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 80),
                _Empty(
                  icon: Icons.local_shipping_outlined,
                  title: 'No deliveries assigned to you',
                  body:
                      'When the warehouse puts your name on a consignment it '
                      'appears here, with the shop it is going to.',
                ),
              ]);
            }
            final outstanding = rows.where((d) => d.isOutstanding).toList();
            final done = rows.where((d) => !d.isOutstanding).toList();
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (outstanding.isNotEmpty) ...[
                  const _SectionTitle('On the road'),
                  for (final d in outstanding) _DeliveryCard(d),
                  const SizedBox(height: 20),
                ],
                if (done.isNotEmpty) ...[
                  const _SectionTitle('Finished'),
                  for (final d in done) _DeliveryCard(d),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DeliveryCard extends StatelessWidget {
  const _DeliveryCard(this.delivery);

  final Delivery delivery;

  static const _statusColours = {
    'in_transit': AppColors.info,
    'delivered': AppColors.success,
    'failed': AppColors.danger,
    'returned': AppColors.warning,
  };

  @override
  Widget build(BuildContext context) {
    final d = delivery;
    final fmt = DateFormat('d MMM');
    final colour = _statusColours[d.status] ?? AppColors.textMuted;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    d.storeName,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 15),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: colour.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    d.status.replaceAll('_', ' '),
                    style: TextStyle(
                        color: colour,
                        fontSize: 11,
                        fontWeight: FontWeight.w600),
                  ),
                ),
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
              // Units and lines, not product names. Naming what is in the box
              // means reading the order's lines, which carry the pricing.
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
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          color: AppColors.textPrimary,
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(title,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 16)),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
