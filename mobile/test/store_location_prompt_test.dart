// 48 of the 209 stores have no coordinates and no geocoder is going to find
// them, so the rep standing in the shop is the instrument. The prompt that
// asks them has to appear in exactly one situation and stay out of the way in
// every other one — a store that already has a point must never be offered a
// second one, because that is how a good location gets replaced by a bad one.
//
// This exercises the screen without a Supabase client: every provider it reads
// is overridden, so nothing here touches the network.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/core/providers.dart';
import 'package:gf_merch_rep/data/models/form_template.dart';
import 'package:gf_merch_rep/data/models/route_visit.dart';
import 'package:gf_merch_rep/data/models/workday_session.dart';
import 'package:gf_merch_rep/features/visit/store_detail_screen.dart';
import 'package:gf_merch_rep/features/workday/workday_controller.dart';

const _visitClientId = 'visit-client-id';
const _routeId = 'route-id';
const _prompt = 'This shop is not on the map';

/// Stands in for the real controller so the screen sees an open workday
/// without a repository, a timer or a GPS.
class _OpenWorkday extends WorkdayController {
  _OpenWorkday(this.session);

  final WorkdaySession? session;

  @override
  Future<WorkdaySession?> build() async => session;
}

WorkdaySession get _session => WorkdaySession(
      id: 'session-id',
      clientGeneratedId: 'session-client-id',
      orgId: 'org-id',
      repId: 'rep-id',
      startedAt: DateTime.now(),
      distanceMeters: 0,
    );

RouteVisit _visit({
  required String status,
  double? lat,
  double? lng,
}) {
  return RouteVisit(
    routeId: _routeId,
    storeId: 'store-id',
    storeName: 'Choppies Super store - Moshupa',
    storeCity: 'Moshupa',
    storeLat: lat,
    storeLng: lng,
    geofenceRadiusM: 100,
    sequenceOrder: 1,
    visitClientGeneratedId: _visitClientId,
    status: status,
  );
}

Future<void> _pump(WidgetTester tester, RouteVisit visit) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        todayRoutesProvider.overrideWith((ref) async => [visit]),
        formTemplatesProvider.overrideWith((ref) async => <FormTemplate>[]),
        submittedTemplateIdsProvider
            .overrideWith((ref, arg) async => <String>{}),
        workdayControllerProvider.overrideWith(() => _OpenWorkday(_session)),
      ],
      child: const MaterialApp(
        home: StoreDetailScreen(visitKey: _routeId),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('offers to capture a location for a store that has none',
      (tester) async {
    await _pump(tester, _visit(status: 'checked_in'));

    expect(find.text(_prompt), findsOneWidget);
    expect(
      find.widgetWithText(ElevatedButton, "Set it to where I'm standing"),
      findsOneWidget,
    );
  });

  testWidgets('never offers to relocate a store that already has a point',
      (tester) async {
    await _pump(
      tester,
      _visit(status: 'checked_in', lat: -24.7701, lng: 25.4101),
    );

    expect(find.text(_prompt), findsNothing);
  });

  testWidgets('stays hidden until the rep has actually checked in',
      (tester) async {
    await _pump(tester, _visit(status: 'not_started'));

    expect(find.text(_prompt), findsNothing);
    // The check-in button is still the thing to do first.
    expect(find.widgetWithText(ElevatedButton, 'Check in'), findsOneWidget);
  });

  testWidgets('is gone once the rep has left the store', (tester) async {
    await _pump(tester, _visit(status: 'checked_out'));

    expect(find.text(_prompt), findsNothing);
  });
}
