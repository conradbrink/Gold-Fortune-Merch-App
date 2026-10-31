import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../shared/widgets/account_menu.dart';
import '../../shared/widgets/message_panel.dart';
import '../deliveries/deliveries_screen.dart';
import 'route_plan.dart';

/// A driver's home, and the whole of their app (owner, 29 Oct 2026): the
/// deliveries the warehouse has given them, a day at a time, grouped by town;
/// "Plan my route" to put them in driving order from where they are standing;
/// and Google Maps to drive it. A card opens the delivery, where the drop is
/// recorded with a photo of the signed delivery note (#225).
///
/// No visits, orders, forms or working day: a driver login is `role =
/// 'driver'`, which the router keeps on this screen and its deliveries.
class DriverHomeScreen extends ConsumerStatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  ConsumerState<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends ConsumerState<DriverHomeScreen> {
  DateTime? _day;

  /// A plan per day, kept while the app is open. Dropped by "Show by town".
  final Map<DateTime, RoutePlan> _plans = {};
  bool _planning = false;

  @override
  Widget build(BuildContext context) {
    final run = ref.watch(driverRunProvider);

    // A drop recorded on this phone has reached the server: ask again, so it
    // moves to Delivered.
    ref.listen(pendingDeliveryConfirmsProvider, (previous, next) {
      final before = previous?.value ?? const <String>{};
      final now = next.value ?? const <String>{};
      if (before.any((id) => !now.contains(id))) {
        ref.invalidate(driverRunProvider);
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('My deliveries'),
        actions: [
          const AccountMenu(),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(driverRunProvider);
          await ref
              .read(driverRunProvider.future)
              .catchError((_) => <RunStop>[]);
        },
        child: run.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => const MessagePanel(
            scrollable: true,
            icon: Icons.wifi_off_outlined,
            title: 'This needs a connection',
            body:
                'Deliveries are not kept on the phone: a list from yesterday '
                'could send you somewhere the warehouse has since taken off '
                'your round. Pull down to try again.',
          ),
          data: _body,
        ),
      ),
    );
  }

  Widget _body(List<RunStop> stops) {
    final today = DateTime.now();
    final days = runDays(stops, today);
    final day = days.contains(_day) ? _day! : days.first;
    final pending =
        ref.watch(pendingDeliveryConfirmsProvider).value ?? const <String>{};

    final onDay = stops
        .where(
          (s) => s.delivery.isOutstanding && dayOf(s.delivery, today) == day,
        )
        .toList();
    // Recorded here and not sent yet: done as far as the driver is concerned,
    // so not on the route any more.
    final toDrive = onDay.where((s) => !pending.contains(s.id)).toList();
    final waiting = onDay.where((s) => pending.contains(s.id)).toList();
    final delivered = stops.where((s) {
      final at = s.delivery.deliveredAt;
      return !s.delivery.isOutstanding &&
          at != null &&
          DateTime(at.year, at.month, at.day) == day;
    }).toList();

    final plan = _plans[day];
    final ordered = plan == null ? null : _inOrder(plan, toDrive);
    final towns = toDrive.map((s) => s.area).toSet().length;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _DayPicker(
          days: days,
          selected: day,
          today: today,
          count: (d) => stops
              .where(
                (s) =>
                    s.delivery.isOutstanding &&
                    !pending.contains(s.id) &&
                    dayOf(s.delivery, today) == d,
              )
              .length,
          onSelected: (d) => setState(() => _day = d),
        ),
        const SizedBox(height: 16),
        if (toDrive.isEmpty && waiting.isEmpty && delivered.isEmpty)
          const MessagePanel(
            icon: Icons.local_shipping_outlined,
            title: 'Nothing to deliver',
            body:
                'When the warehouse gives you a delivery for this day it '
                'appears here, with where it is going.',
          ),
        if (toDrive.isNotEmpty) ...[
          Text(
            '${toDrive.length} ${toDrive.length == 1 ? 'delivery' : 'deliveries'} '
            'to drop in $towns ${towns == 1 ? 'town' : 'towns'}',
            style: const TextStyle(color: AppColors.textMuted),
          ),
          const SizedBox(height: 12),
          if (ordered == null) ...[
            FilledButton.icon(
              onPressed: _planning ? null : () => _plan(day, toDrive),
              icon: _planning
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.route),
              label: Text(_planning ? 'Planning…' : 'Plan my route'),
            ),
            const SizedBox(height: 20),
            for (final g in byArea(toDrive)) ...[
              SectionTitle('${g.area} · ${g.stops.length}'),
              for (final s in g.stops)
                DeliveryCard(s.delivery, basePath: '/driver'),
              const SizedBox(height: 12),
            ],
          ] else
            ..._planned(day, plan!, ordered),
        ],
        if (waiting.isNotEmpty) ...[
          const SizedBox(height: 8),
          const SectionTitle('Recorded on this phone'),
          for (final s in waiting)
            DeliveryCard(s.delivery, basePath: '/driver'),
        ],
        if (delivered.isNotEmpty) ...[
          const SizedBox(height: 8),
          const SectionTitle('Delivered'),
          for (final s in delivered)
            DeliveryCard(s.delivery, basePath: '/driver'),
        ],
      ],
    );
  }

  List<Widget> _planned(DateTime day, RoutePlan plan, List<RunStop> ordered) {
    final legs = mapsLegs(ordered);
    final unfound = ordered.where((s) => s.mapsPlace == null).length;
    return [
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: context.brand.primary.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          [
            plan.byGoogle
                ? 'Planned on the roads by Google${plan.summary == null ? '' : ': ${plan.summary}'}.'
                : plan.note ?? 'In order of the nearest stop each time.',
            if (unfound > 0)
              '$unfound ${unfound == 1 ? 'stop has' : 'stops have'} no address, '
                  'so Google Maps skips ${unfound == 1 ? 'it' : 'them'}.',
          ].join(' '),
          style: const TextStyle(fontSize: 13),
        ),
      ),
      const SizedBox(height: 12),
      for (final leg in legs)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: FilledButton.icon(
            onPressed: () => _open(leg.uri),
            icon: const Icon(Icons.navigation_outlined),
            label: Text(
              legs.length == 1
                  ? 'Drive it in Google Maps'
                  : 'Stops ${leg.first}–${leg.last} in Google Maps',
            ),
          ),
        ),
      if (legs.length > 1)
        const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: Text(
            'Google Maps takes ten stops at a time. Open the next part when '
            'you reach the last stop of this one.',
            style: TextStyle(color: AppColors.textMuted, fontSize: 12),
          ),
        ),
      Row(
        children: [
          TextButton.icon(
            onPressed: _planning ? null : () => _plan(day, ordered),
            icon: const Icon(Icons.refresh),
            label: const Text('Plan again from here'),
          ),
          const Spacer(),
          TextButton(
            onPressed: () => setState(() => _plans.remove(day)),
            child: const Text('Show by town'),
          ),
        ],
      ),
      const SizedBox(height: 8),
      for (var i = 0; i < ordered.length; i++)
        DeliveryCard(ordered[i].delivery, basePath: '/driver', stop: i + 1),
    ];
  }

  /// The plan's order over what is still to drive. A delivery given to the
  /// driver after the plan was made goes at the end; one that is done or
  /// taken away drops out.
  static List<RunStop> _inOrder(RoutePlan plan, List<RunStop> toDrive) {
    final byId = {for (final s in toDrive) s.id: s};
    final ordered = [
      for (final id in plan.order)
        if (byId.containsKey(id)) byId[id]!,
    ];
    final placed = ordered.map((s) => s.id).toSet();
    return [...ordered, ...toDrive.where((s) => !placed.contains(s.id))];
  }

  Future<void> _plan(DateTime day, List<RunStop> stops) async {
    setState(() => _planning = true);
    try {
      final double lat;
      final double lng;
      try {
        final here = await LocationService.getCurrentPosition();
        lat = here.latitude;
        lng = here.longitude;
      } on LocationDeniedException {
        _say('Turn on location so the route can start from where you are.');
        return;
      } catch (_) {
        _say('Where you are could not be found just now. Try again.');
        return;
      }
      final google = await ref
          .read(driverRepositoryProvider)
          .googleOrder(
            lat: lat,
            lng: lng,
            dispatchIds: [for (final s in stops) s.id],
          );
      final unpinned = stops.any((s) => !s.pinned);
      final plan =
          google ??
          RoutePlan(
            order: nearestFirst(lat, lng, stops),
            byGoogle: false,
            note: straightLineNote(unpinned: unpinned),
          );
      if (mounted) setState(() => _plans[day] = plan);
    } finally {
      if (mounted) setState(() => _planning = false);
    }
  }

  Future<void> _open(Uri uri) async {
    final opened = await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    ).catchError((Object _) => false);
    if (!opened) _say('No app on this phone could open Google Maps.');
  }

  void _say(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }
}

/// Today, then each later day that has something on the road.
class _DayPicker extends StatelessWidget {
  const _DayPicker({
    required this.days,
    required this.selected,
    required this.today,
    required this.count,
    required this.onSelected,
  });

  final List<DateTime> days;
  final DateTime selected;
  final DateTime today;
  final int Function(DateTime) count;
  final ValueChanged<DateTime> onSelected;

  String _label(DateTime d) {
    final t = DateTime(today.year, today.month, today.day);
    if (d == t) return 'Today';
    if (d == t.add(const Duration(days: 1))) return 'Tomorrow';
    return DateFormat('EEE d MMM').format(d);
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final d in days)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text('${_label(d)} (${count(d)})'),
                selected: d == selected,
                onSelected: (_) => onSelected(d),
              ),
            ),
        ],
      ),
    );
  }
}
