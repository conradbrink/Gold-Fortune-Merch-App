import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/route_visit.dart';
import '../driver/route_plan.dart';
import 'visit_plan.dart';

/// On Today's Route, under the workday: "Plan my route" to put the stops
/// still to visit in driving order from where the rep is, and, once there is
/// a plan, Google Maps to drive it. The list below is already in the plan's
/// order (RouteRepository lays it over the day).
///
/// Shown from two stops still to visit, or one left of a plan. With nothing
/// left to drive to it is not shown at all.
class RoutePlanPanel extends ConsumerStatefulWidget {
  const RoutePlanPanel({super.key, required this.day});

  /// The day as the list shows it, already in the plan's order.
  final List<RouteVisit> day;

  @override
  ConsumerState<RoutePlanPanel> createState() => _RoutePlanPanelState();
}

class _RoutePlanPanelState extends ConsumerState<RoutePlanPanel> {
  bool _planning = false;

  @override
  Widget build(BuildContext context) {
    final plan = ref.watch(visitPlanProvider).value;
    final stops = stopsToVisit(widget.day);
    if (stops.length < (plan == null ? 2 : 1)) return const SizedBox.shrink();

    final planButton = plan == null
        ? FilledButton.icon(
            onPressed: _planning ? null : _plan,
            icon: _planning
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.route),
            label: Text(_planning ? 'Planning…' : 'Plan my route'),
          )
        : null;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (plan == null) ...[
            const Text(
              'Put the stops you still have to do in the best order to '
              'drive, starting from where you are now.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5),
            ),
            const SizedBox(height: 10),
            planButton!,
          ] else
            ..._planned(plan, stops),
        ],
      ),
    );
  }

  List<Widget> _planned(RoutePlan plan, List<VisitStop> stops) {
    final legs = mapsLegs(stops);
    final unfound = stops.where((s) => s.mapsPlace == null).length;
    return [
      Text(
        [
          plan.byGoogle
              ? 'Your stops are in the best order to drive, worked out on '
                    'the roads by Google'
                    '${plan.summary == null || !planStillWhole(plan, widget.day) ? '' : ' (${plan.summary})'}.'
              : plan.note ??
                    'Your stops are in order of the closest one each time.',
          if (unfound > 0)
            unfound == 1
                ? 'Google Maps will leave out 1 stop, because it has no '
                      'address.'
                : 'Google Maps will leave out $unfound stops, because they '
                      'have no address.',
        ].join(' '),
        style: const TextStyle(fontSize: 12.5, color: AppColors.textPrimary),
      ),
      const SizedBox(height: 10),
      for (final leg in legs)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: FilledButton.icon(
            onPressed: () => _open(leg.uri),
            icon: const Icon(Icons.navigation_outlined),
            label: Text(
              legs.length == 1
                  ? 'Open Google Maps'
                  : 'Drive stops ${leg.first}–${leg.last}',
            ),
          ),
        ),
      if (legs.length > 1)
        const Padding(
          padding: EdgeInsets.only(bottom: 4),
          child: Text(
            'Google Maps can only take ten stops at a time. When you reach '
            'the last stop of one part, come back here and open the next.',
            style: TextStyle(color: AppColors.textMuted, fontSize: 12),
          ),
        ),
      if (stops.length > 1)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: _planning ? null : _plan,
            icon: _planning
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh),
            label: Text(_planning ? 'Planning…' : 'Plan again'),
          ),
        ),
    ];
  }

  Future<void> _plan() async {
    final repId = ref.read(currentUserProvider)?.id;
    if (repId == null) return;
    setState(() => _planning = true);
    try {
      final message = await planToday(
        ref.read(routeRepositoryProvider),
        repId: repId,
        day: widget.day,
        date: ref.read(selectedRouteDateProvider),
      );
      if (message != null) {
        _say(message);
        return;
      }
      ref.invalidate(todayRoutesProvider);
      ref.invalidate(visitPlanProvider);
    } catch (_) {
      _say('Your route could not be planned just now. Please try again.');
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
