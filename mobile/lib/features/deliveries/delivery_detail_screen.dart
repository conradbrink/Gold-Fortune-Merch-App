import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' show ClientException;
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/delivery.dart';
import '../../data/sync/sync_engine.dart' show isTransientNetworkFailure;
import '../../shared/widgets/message_panel.dart';
import 'deliveries_screen.dart';
import 'delivery_confirm_sheet.dart';

/// One delivery, opened from "My deliveries": where it is going, who to ask
/// for, and what is in it. The products come without prices, from
/// `delivery_contents()`.
///
/// The rep it is assigned to records the drop here, with a photo of the
/// signed delivery note ([showDeliveryConfirmSheet]). It is queued, so the
/// screen says so until it has reached the server.
class DeliveryDetailScreen extends ConsumerWidget {
  const DeliveryDetailScreen({super.key, required this.dispatchId});

  final String dispatchId;

  /// No signal, as against the server answering and saying no. The second
  /// must not send a rep looking for signal they already have.
  static bool _offline(Object e) =>
      isTransientNetworkFailure(e) || e is ClientException;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final provider = deliveryDetailProvider(dispatchId);
    final detail = ref.watch(provider);
    final byName = ref.watch(companyConfigValueProvider).has('distribution');
    final waiting = ref.watch(pendingDeliveryConfirmsProvider).value?.contains(dispatchId) ?? false;

    // The drop this phone recorded has reached the server: ask again, so the
    // screen, the list and the badge show it delivered.
    ref.listen(pendingDeliveryConfirmsProvider, (previous, next) {
      final was = previous?.value?.contains(dispatchId) ?? false;
      final now = next.value?.contains(dispatchId) ?? false;
      if (was && !now) {
        ref.invalidate(provider);
        ref.invalidate(myDeliveriesProvider);
        ref.invalidate(outstandingDeliveryCountProvider);
      }
    });

    ref.listen(provider, (previous, next) {
      if (next.isLoading) return;
      // A pull that failed keeps what was on screen, and says so.
      if (next.hasError && next.hasValue) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _offline(next.error!)
                  ? 'No connection. This is what it said last time.'
                  : 'This delivery could not be refreshed.',
            ),
          ),
        );
        return;
      }
      if (!next.hasValue) return;
      // The list and the home badge are kept, not fetched again; when this
      // fresh answer disagrees with the list, both are asked again, so going
      // back does not show "in transit" for a delivery that has arrived.
      final listed = ref
          .read(myDeliveriesProvider)
          .value
          ?.where((d) => d.id == dispatchId)
          .firstOrNull;
      final fresh = next.value;
      if (listed != null && fresh?.delivery.status != listed.status) {
        ref.invalidate(myDeliveriesProvider);
        ref.invalidate(outstandingDeliveryCountProvider);
      }
    });

    final open = detail.value;
    final canRecord = open != null && open.delivery.isOutstanding && !waiting;

    return Scaffold(
      appBar: AppBar(title: const Text('Delivery')),
      bottomNavigationBar: canRecord
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                  onPressed: () async {
                    final queued = await showDeliveryConfirmSheet(context, open);
                    if (queued == true && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Delivery saved. It will reach the warehouse when you have signal.',
                          ),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.task_alt),
                  label: const Text('Record delivery'),
                ),
              ),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: () =>
            ref.refresh(provider.future).then((_) {}, onError: (_) {}),
        child: detail.when(
          skipError: true,
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => _offline(e)
              ? const MessagePanel(
                  scrollable: true,
                  icon: Icons.wifi_off_outlined,
                  title: 'This needs a connection',
                  body:
                      'Deliveries are not kept on the phone. Pull down to '
                      'try again when you have signal.',
                )
              : const MessagePanel(
                  scrollable: true,
                  icon: Icons.error_outline,
                  title: 'This delivery could not be opened',
                  body:
                      'Pull down to try again. If it keeps happening, tell '
                      'the office.',
                ),
          data: (d) => d == null
              ? const MessagePanel(
                  scrollable: true,
                  icon: Icons.assignment_return_outlined,
                  title: 'This delivery is not yours any more',
                  body:
                      'The warehouse may have given it to somebody else. '
                      'Ask them if you were expecting it.',
                )
              : _Body(d, byName: byName, waiting: waiting),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body(this.detail, {required this.byName, required this.waiting});

  final DeliveryDetail detail;
  final bool byName;

  /// Recorded as delivered on this phone, not yet sent.
  final bool waiting;

  @override
  Widget build(BuildContext context) {
    final d = detail;
    final lines = d.lines;
    final notes = [
      if (d.failureReason != null) ('Why it did not arrive', d.failureReason!),
      if (d.orderNotes != null) ('Note on the order', d.orderNotes!),
      if (d.dispatchNotes != null)
        ('Note from the warehouse', d.dispatchNotes!),
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _Header(d, byName: byName),
        if (waiting && d.delivery.isOutstanding) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: context.brand.accent.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Row(
              children: [
                Icon(Icons.cloud_upload_outlined, size: 20),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'You recorded this as delivered. It will reach the '
                    'warehouse, with the photo, when you have signal.',
                    style: TextStyle(fontSize: 13),
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 12),
        _Facts(d),
        if (notes.isNotEmpty) ...[
          const SizedBox(height: 12),
          Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final (i, n) in notes.indexed) ...[
                    if (i > 0) const SizedBox(height: 10),
                    Text(
                      n.$1,
                      style: const TextStyle(
                        color: AppColors.textMuted,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(n.$2),
                  ],
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 20),
        const SectionTitle('In this delivery'),
        if (lines == null)
          const _Note(
            'The products could not be loaded. Pull down to try again.',
          )
        else if (lines.isEmpty)
          const _Note('The warehouse has not listed what is in this delivery.')
        else ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              '${d.delivery.units} ${d.delivery.units == 1 ? 'unit' : 'units'}'
              ' · ${d.delivery.lineCount} '
              '${d.delivery.lineCount == 1 ? 'product' : 'products'}',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
          ),
          Card(
            margin: EdgeInsets.zero,
            child: Column(
              children: [
                for (final (i, l) in lines.indexed) ...[
                  if (i > 0) const Divider(height: 1),
                  _LineRow(l, finished: !d.delivery.isOutstanding),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Text(text, style: const TextStyle(color: AppColors.textMuted)),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.detail, {required this.byName});

  final DeliveryDetail detail;
  final bool byName;

  @override
  Widget build(BuildContext context) {
    final d = detail;
    final directions = d.directions(byName: byName);
    final dial = d.dial;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    d.delivery.storeName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 17,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                DeliveryStatusChip(d.delivery.status),
              ],
            ),
            if (d.address != null) ...[
              const SizedBox(height: 4),
              Text(
                d.address!,
                style: const TextStyle(color: AppColors.textMuted),
              ),
            ],
            if (directions != null || dial != null) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (directions != null)
                    FilledButton.icon(
                      onPressed: () => _open(context, directions),
                      icon: const Icon(Icons.directions_outlined),
                      label: const Text('Directions'),
                    ),
                  if (dial != null)
                    OutlinedButton.icon(
                      onPressed: () => _open(context, dial),
                      icon: const Icon(Icons.call_outlined),
                      label: Text(
                        d.contactName == null
                            ? 'Call'
                            : 'Call ${d.contactName}',
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context, Uri uri) async {
    final opened = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    ).catchError((Object _) => false);
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No app on this phone could open it.')),
      );
    }
  }
}

class _Facts extends StatelessWidget {
  const _Facts(this.detail);

  final DeliveryDetail detail;

  /// "Thu 22 Oct, 9:15 AM": the day, and the time the way the rest of the
  /// app writes one.
  static String _when(DateTime t) =>
      '${DateFormat('EEE d MMM').format(t)}, ${DateFormat.jm().format(t)}';

  @override
  Widget build(BuildContext context) {
    final d = detail;
    final expiry = d.poExpiry(DateTime.now());
    final rows = <(String, String, Color?)>[
      ('Order', d.delivery.orderNumber, null),
      if (d.poNumber != null) ('PO number', d.poNumber!, null),
      if (expiry != null)
        (
          'PO',
          expiry.words,
          switch (expiry.urgency) {
            PoUrgency.lapsed => AppColors.danger,
            PoUrgency.soon => AppColors.warning,
            PoUrgency.calm => null,
          },
        ),
      if (d.contactName != null || d.contactPhone != null)
        (
          'Contact',
          [d.contactName, d.contactPhone].whereType<String>().join(' · '),
          null,
        ),
      ('Left the warehouse', _when(d.delivery.dispatchedAt), null),
      if (d.delivery.expectedOn != null && d.delivery.isOutstanding)
        ('Due', DateFormat('EEE d MMM').format(d.delivery.expectedOn!), null),
      if (d.delivery.deliveredAt != null)
        ('Arrived', _when(d.delivery.deliveredAt!), null),
      if (d.receivedBy != null) ('Received by', d.receivedBy!, null),
      if (d.delivery.carrier != null) ('Carrier', d.delivery.carrier!, null),
      if (d.delivery.trackingReference != null)
        ('Tracking', d.delivery.trackingReference!, null),
      ('Dispatch', d.delivery.dispatchNumber, null),
    ];

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Column(
          children: [
            for (final (label, value, colour) in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 128,
                      child: Text(
                        label,
                        style: const TextStyle(
                          color: AppColors.textMuted,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        value,
                        style: TextStyle(
                          fontSize: 13,
                          color: colour,
                          fontWeight: colour == null ? null : FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// One product. A plain row rather than a ListTile: a ListTile's trailing
/// slot is capped at 56 px, and the units with the shrinks under them
/// overflow it once the phone's text is set large.
class _LineRow extends StatelessWidget {
  const _LineRow(this.line, {required this.finished});

  final DeliveryLine line;

  /// Once the warehouse has recorded the drop, what arrived and what came
  /// back are worth more than what left.
  final bool finished;

  @override
  Widget build(BuildContext context) {
    final l = line;
    final about = [
      if (l.brand != null) l.brand!,
      if (l.skuCode != null) l.skuCode!,
    ].join(' · ');
    final outcome = finished && (l.qtyDelivered > 0 || l.qtyReturned > 0)
        ? [
            '${l.qtyDelivered} delivered',
            if (l.qtyReturned > 0) '${l.qtyReturned} returned',
          ].join(' · ')
        : null;
    final shrinks = l.inShrinks;
    const muted = TextStyle(color: AppColors.textMuted, fontSize: 12);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.productName, style: const TextStyle(fontSize: 14)),
                if (about.isNotEmpty) Text(about, style: muted),
                if (l.shortBy > 0)
                  Text(
                    'Ordered ${l.qtyOrdered} units',
                    style: const TextStyle(
                      color: AppColors.warning,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                if (outcome != null) Text(outcome, style: muted),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${l.qty} ${l.qty == 1 ? 'unit' : 'units'}',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 14,
                ),
              ),
              if (shrinks != null) Text(shrinks, style: muted),
            ],
          ),
        ],
      ),
    );
  }
}
