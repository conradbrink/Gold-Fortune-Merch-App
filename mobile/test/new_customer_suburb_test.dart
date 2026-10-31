// A rep adding a customer picks the suburb from the company's own, so the
// server can place the customer in its area (`store_add_from_phone()`,
// 20261031154700).
//
// Owner, 31 Oct 2026: reps typed the town ("MITCHELL S PLAIN WESTRIDGE",
// "TABLEVIEW") and every customer they added had a town the office had to
// tidy and no area. What these hold: the suburbs are the towns of customers
// already in an area, each once in the spelling most of them have; a search
// finds a suburb inside what the rep typed, and the part of town beside it
// goes to the address; a suburb not on the list can still be typed in; and a
// company with no suburbs keeps the plain town field.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/providers.dart';
import 'package:gf_merch_rep/core/terms.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/profile.dart';
import 'package:gf_merch_rep/data/models/store_summary.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:gf_merch_rep/features/visit/new_customer_screen.dart';
import 'package:gf_merch_rep/features/visit/suburb_picker.dart';

const _json = {'content-type': 'application/json'};

StoreSummary _store(String id, String? city, {String? area}) => StoreSummary(
      id: id,
      name: 'Shop $id',
      city: city,
      territoryId: area,
      geofenceRadiusM: 100,
    );

/// Adding a customer here sends nothing anywhere.
class _SilentSync extends SyncEngine {
  _SilentSync(AppDatabase db)
      : super(
          db,
          SupabaseClient(
            'http://localhost:1',
            'test-anon-key',
            authOptions: const AuthClientOptions(autoRefreshToken: false),
          ),
        );

  @override
  Future<void> sync() async {}
}

final _distribution = CompanyConfig(
  modules: {'core', 'distribution'},
  pingInterval: CompanyConfig.fallback.pingInterval,
  shortVisit: CompanyConfig.fallback.shortVisit,
  autoEnd: CompanyConfig.fallback.autoEnd,
  checkinRadiusM: 100,
);

/// A company's customers: Mitchells Plain mostly spelled so, Table View, and
/// towns with no area that are not suburbs to pick.
final _company = [
  _store('s1', 'Mitchells Plain', area: 'mp'),
  _store('s2', 'Mitchells Plain', area: 'mp'),
  _store('s3', 'MITCHELLS PLAIN', area: 'mp'),
  _store('s4', 'Table View', area: 'milnerton'),
  _store('s5', 'Strandfontein', area: 'sf'),
  _store('s6', 'TABLEVIEW'),
  _store('s7', 'Mitchell S PLAIN WESTRIDGE'),
  _store('s8', null, area: 'mp'),
  _store('s9', '  ', area: 'mp'),
];

void main() {
  group('the suburbs', () {
    test('are the towns of customers in an area, once each, A–Z', () {
      expect(companySuburbs(_company), ['Mitchells Plain', 'Strandfontein', 'Table View']);
      expect(companySuburbs([_store('a', 'Gaborone')]), isEmpty);
    });

    test('are spelled as most of their customers have it', () {
      expect(
        companySuburbs([
          _store('a', 'MITCHELLS PLAIN', area: 'x'),
          _store('b', 'MITCHELLS PLAIN', area: 'x'),
          _store('c', "Mitchell's Plain", area: 'y'),
        ]),
        ['MITCHELLS PLAIN'],
      );
    });

    test('a place is its letters and digits, in small letters', () {
      expect(placeKey("MITCHELL'S  Plain"), 'mitchellsplain');
      expect(placeKey('Table View'), placeKey('TABLEVIEW'));
      expect(placeKey(' - '), '');
    });

    test('the words beside a suburb are the ones that do not spell it', () {
      expect(wordsBeside('Mitchell S PLAIN WESTRIDGE', 'Mitchells Plain'), 'WESTRIDGE');
      expect(wordsBeside('new woodlands, mitchells plain', 'Mitchells Plain'), 'new woodlands');
      expect(wordsBeside('TABLEVIEW', 'Table View'), '');
      // Part of a word does not spell it.
      expect(wordsBeside('Strandfontein', 'Strand'), isNull);
      expect(wordsBeside('Westridge', 'Mitchells Plain'), isNull);
    });

    test('a search puts the same name first, then one spelled out, then the rest', () {
      final suburbs = ['Mitchells Plain', 'Plainview', 'Strand', 'Strandfontein', 'Table View'];
      expect(suburbsMatching(suburbs, ''), suburbs);
      expect(suburbsMatching(suburbs, 'mitch'), ['Mitchells Plain']);
      expect(suburbsMatching(suburbs, 'Mitchell S PLAIN WESTRIDGE'), ['Mitchells Plain']);
      expect(suburbsMatching(suburbs, 'tableview'), ['Table View']);
      expect(suburbsMatching(suburbs, 'strand'), ['Strand', 'Strandfontein']);
      expect(suburbsMatching(suburbs, 'plain'), ['Plainview', 'Mitchells Plain']);
      expect(suburbsMatching(suburbs, 'Westridge'), isEmpty);
    });

    test('the part of town is tidied and added to the address once', () {
      expect(partOfTown('WESTRIDGE'), 'Westridge');
      expect(partOfTown('new  woodlands'), 'New Woodlands');
      expect(partOfTown('Lentegeur Ext'), 'Lentegeur Ext');
      expect(addressWith('23 Wespoort Road', 'Westridge'), '23 Wespoort Road, Westridge');
      expect(addressWith('23 Wespoort Rd, WESTRIDGE', 'Westridge'), '23 Wespoort Rd, WESTRIDGE');
      expect(addressWith('  ', 'Westridge'), 'Westridge');
      expect(addressWithout('23 Wespoort Road, Westridge', 'Westridge'), '23 Wespoort Road');
      expect(addressWithout('Westridge', 'Westridge'), '');
      expect(addressWithout('Westridge Mall, Rose St', 'Westridge'), 'Westridge Mall, Rose St');
    });
  });

  group('the customer list', () {
    late AppDatabase db;
    late SupabaseClient client;
    late List<http.Request> requests;

    setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
    tearDown(() async {
      await client.dispose();
      await db.close();
    });

    test('carries each customer\'s area, and keeps it with no signal', () async {
      requests = [];
      client = SupabaseClient(
        'http://localhost:54321',
        'anon-key',
        httpClient: MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode([
              {'id': 's1', 'name': 'Shop', 'city': 'Mitchells Plain', 'territory_id': 'mp', 'geofence_radius_m': 100},
            ]),
            200,
            headers: _json,
            request: request,
          );
        }),
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      final stores = await RouteRepository(client, db).fetchStores();
      expect(requests.first.url.queryParameters['select'], contains('territory_id'));
      expect(stores.single.territoryId, 'mp');

      await client.dispose();
      client = SupabaseClient(
        'http://localhost:54321',
        'anon-key',
        httpClient: MockClient((r) async => http.Response('offline', 503, request: r)),
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      final cached = await RouteRepository(client, db).fetchStores();
      expect(companySuburbs(cached), ['Mitchells Plain']);
    });
  });

  group('on the phone', () {
    late AppDatabase db;
    setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
    tearDown(() => db.close());

    // Made and closed outside the widget tester's clock: closing it waits on
    // timers that clock never runs.
    late SupabaseClient offline;
    setUpAll(() => offline = SupabaseClient(
          'http://localhost:1',
          'test-anon-key',
          httpClient: MockClient((r) async => http.Response('offline', 503, request: r)),
          authOptions: const AuthClientOptions(autoRefreshToken: false),
        ));
    tearDownAll(() => offline.dispose());

    final area = Terms.defaults.territory.oneLower;

    Future<void> open(WidgetTester tester, List<StoreSummary> stores) async {
      final router = GoRouter(
        initialLocation: '/unscheduled/order/new?name=Bismillah%20Superette',
        routes: [
          GoRoute(
            path: '/unscheduled/order/new',
            builder: (_, state) => NewCustomerScreen(
              forOrder: true,
              name: state.uri.queryParameters['name'],
            ),
          ),
          GoRoute(
            path: '/unscheduled/order/:storeId',
            builder: (_, state) => Text('Order for ${state.pathParameters['storeId']}'),
          ),
        ],
      );
      final container = ProviderContainer(
        overrides: [
          termsProvider.overrideWithValue(Terms.defaults),
          companyConfigValueProvider.overrideWithValue(_distribution),
          storesProvider.overrideWith((ref) async => stores),
          storeGroupsProvider.overrideWith((ref) async => const []),
          routeRepositoryProvider.overrideWithValue(RouteRepository(offline, db)),
          syncEngineProvider.overrideWithValue(_SilentSync(db)),
          profileProvider.overrideWith(
            (ref) async => const Profile(id: 'rep-1', orgId: 'org-1', role: 'rep'),
          ),
        ],
      );
      addTearDown(container.dispose);
      await tester.runAsync(() => container.read(profileProvider.future));
      await tester.runAsync(() => container.read(storesProvider.future));
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ));
      await tester.pump();
    }

    TextEditingController field(WidgetTester tester, String label) =>
        tester.widget<TextField>(find.widgetWithText(TextField, label)).controller!;

    /// Opens the suburb list and searches it. Pumped by hand: the search
    /// field keeps its cursor blinking, so nothing ever settles.
    Future<void> searchSuburbs(WidgetTester tester, String search) async {
      final town = find.widgetWithText(TextField, 'Suburb or town');
      await tester.ensureVisible(town);
      await tester.tap(town);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.enterText(find.widgetWithText(TextField, 'Search suburbs'), search);
      await tester.pump();
    }

    Future<void> pick(WidgetTester tester, String suburb) async {
      await tester.tap(find.widgetWithText(ListTile, suburb));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
    }

    Future<Map<String, dynamic>> addIt(WidgetTester tester) async {
      await tester.enterText(find.widgetWithText(TextField, 'Contact person'), 'Mr Adams');
      await tester.enterText(find.widgetWithText(TextField, 'Contact number'), '0821234567');
      await tester.pump();
      await tester.ensureVisible(find.text('Add and continue'));
      await tester.tap(find.text('Add and continue'));
      // The database answers in real time, the screen in test time: let both
      // run until the customer is saved and the order screen is up.
      for (var i = 0; i < 20 && find.textContaining('Order for').evaluate().isEmpty; i++) {
        await tester.pump();
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      }
      await tester.pump();
      final added = (await tester.runAsync(db.pendingEntries))!
          .where((e) => e.entityType == OutboxType.storeAdd)
          .single;
      expect(find.text('Order for ${added.clientGeneratedId}'), findsOneWidget);
      return jsonDecode(added.payload) as Map<String, dynamic>;
    }

    testWidgets('a shop in Westridge is added in Mitchells Plain, Westridge in its address',
        (tester) async {
      await open(tester, _company);
      await tester.enterText(find.widgetWithText(TextField, 'Delivery address'), '23 Wespoort Road');
      await tester.pump();

      // Typed the way reps did: the suburb is found inside it.
      await searchSuburbs(tester, 'Mitchell S PLAIN WESTRIDGE');
      expect(find.text('Adds Westridge to the address'), findsOneWidget);
      expect(find.text('Table View'), findsNothing);
      await pick(tester, 'Mitchells Plain');

      expect(field(tester, 'Suburb or town').text, 'Mitchells Plain');
      expect(field(tester, 'Delivery address').text, '23 Wespoort Road, Westridge');
      expect(find.textContaining('lands in the right $area'), findsOneWidget);

      final payload = await addIt(tester);
      expect(payload['name'], 'Bismillah Superette');
      expect(payload['city'], 'Mitchells Plain');
      expect(payload['address'], '23 Wespoort Road, Westridge');
    });

    testWidgets('a few letters find the suburb, and the address is left alone', (tester) async {
      await open(tester, _company);
      await tester.enterText(find.widgetWithText(TextField, 'Delivery address'), '9 Kudu St');
      await searchSuburbs(tester, 'mitch');
      expect(find.text('Mitchells Plain'), findsOneWidget);
      expect(find.textContaining('Adds'), findsNothing);
      await pick(tester, 'Mitchells Plain');

      expect(field(tester, 'Delivery address').text, '9 Kudu St');
      final payload = await addIt(tester);
      expect(payload['city'], 'Mitchells Plain');
    });

    testWidgets('a suburb not on the list can still be typed in', (tester) async {
      await open(tester, _company);
      await tester.enterText(find.widgetWithText(TextField, 'Delivery address'), '1 Main Road');
      await searchSuburbs(tester, 'westridge');
      expect(find.textContaining('No suburb on your list matches “westridge”'), findsOneWidget);
      await pick(tester, 'Use “westridge”');

      expect(field(tester, 'Suburb or town').text, 'westridge');
      expect(find.textContaining('the office may need to choose its $area'), findsOneWidget);
      final payload = await addIt(tester);
      expect(payload['city'], 'westridge');
      expect(payload['address'], '1 Main Road');
    });

    testWidgets('the suburb can be cleared', (tester) async {
      await open(tester, _company);
      await searchSuburbs(tester, 'table');
      await pick(tester, 'Table View');
      expect(field(tester, 'Suburb or town').text, 'Table View');

      await tester.tap(find.byTooltip('Clear'));
      await tester.pump();
      expect(field(tester, 'Suburb or town').text, isEmpty);
    });

    testWidgets('picking again takes the last part of town off the address', (tester) async {
      await open(tester, _company);
      await tester.enterText(find.widgetWithText(TextField, 'Delivery address'), '5 Eland St');
      await searchSuburbs(tester, 'mitchells plain westridge');
      await pick(tester, 'Mitchells Plain');
      expect(field(tester, 'Delivery address').text, '5 Eland St, Westridge');

      await searchSuburbs(tester, 'mitchells plain lentegeur');
      await pick(tester, 'Mitchells Plain');
      expect(field(tester, 'Delivery address').text, '5 Eland St, Lentegeur');

      await tester.tap(find.byTooltip('Clear'));
      await tester.pump();
      expect(field(tester, 'Delivery address').text, '5 Eland St');
    });

    testWidgets('a company with no suburbs keeps the plain town field', (tester) async {
      await open(tester, [_store('a', 'Gaborone'), _store('b', 'Mahikeng')]);
      expect(find.widgetWithText(TextField, 'Suburb or town'), findsNothing);
      await tester.enterText(find.widgetWithText(TextField, 'Delivery address'), '12 Main Road');
      await tester.enterText(find.widgetWithText(TextField, 'Town (optional)'), ' Mahikeng ');
      final payload = await addIt(tester);
      expect(payload['city'], 'Mahikeng');
    });
  });
}
