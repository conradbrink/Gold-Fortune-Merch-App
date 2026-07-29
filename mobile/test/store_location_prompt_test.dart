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

/// The card has two headings, and which one appears is the whole point: a store
/// with no coordinates is being placed, one with a guessed point is being
/// corrected.
///
/// Both are asserted on, and so is the button label. An earlier version of this
/// file checked only the "not on the map" heading, so when the offer was
/// extended to guessed positions the test that claimed such stores were never
/// offered kept passing — the heading had simply changed underneath it. A test
/// that passes for the wrong reason is worse than no test.
const _blankPrompt = 'This shop is not on the map';
const _guessPrompt = 'This shop’s position is a guess';

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
  String? source,
}) {
  return RouteVisit(
    routeId: _routeId,
    storeId: 'store-id',
    storeName: 'Choppies Super store - Moshupa',
    storeCity: 'Moshupa',
    storeLat: lat,
    storeLng: lng,
    storeGeocodeSource: source,
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
  testWidgets('offers to place a store that has no location at all',
      (tester) async {
    await _pump(tester, _visit(status: 'checked_in'));

    expect(find.text(_blankPrompt), findsOneWidget);
    expect(
      find.widgetWithText(ElevatedButton, "Set it to where I'm standing"),
      findsOneWidget,
    );
  });

  // The behaviour this file originally asserted the opposite of. A store whose
  // point came from a name search has never been checked by anyone, and the rep
  // in the doorway is the person who can settle it — offering only on stores
  // with *no* coordinates hid the button on 194 of 209 stores, which is to say
  // on every store that actually needed it.
  testWidgets('offers to correct a store sitting on a geocoder’s guess',
      (tester) async {
    await _pump(
      tester,
      _visit(
        status: 'checked_in',
        lat: -24.7701,
        lng: 25.4101,
        source: 'places',
      ),
    );

    expect(find.text(_guessPrompt), findsOneWidget);
    expect(
      find.widgetWithText(ElevatedButton, "Move it to where I'm standing"),
      findsOneWidget,
    );
  });

  testWidgets('leaves alone a location another rep measured on site',
      (tester) async {
    await _pump(
      tester,
      _visit(
        status: 'checked_in',
        lat: -24.7701,
        lng: 25.4101,
        source: 'rep',
      ),
    );

    expect(find.text(_blankPrompt), findsNothing);
    expect(find.text(_guessPrompt), findsNothing);
    // Check out is the only primary action left.
    expect(find.widgetWithText(ElevatedButton, 'Check out'), findsOneWidget);
  });

  testWidgets('stays hidden until the rep has actually checked in',
      (tester) async {
    await _pump(tester, _visit(status: 'not_started'));

    expect(find.text(_blankPrompt), findsNothing);
    expect(find.text(_guessPrompt), findsNothing);
    // The check-in button is still the thing to do first.
    expect(find.widgetWithText(ElevatedButton, 'Check in'), findsOneWidget);
  });

  testWidgets('is gone once the rep has left the store', (tester) async {
    await _pump(tester, _visit(status: 'checked_out'));

    expect(find.text(_blankPrompt), findsNothing);
    expect(find.text(_guessPrompt), findsNothing);
  });
}
