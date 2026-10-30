// Customers with the same name, and more customers than one request returns.
//
// A distributor (30 Oct 2026) had four pairs of shops sharing a name in their
// own books, and reps meeting another one could not add it: the phone offered
// the shop already on the list and the Add button did nothing. Their list had
// also passed 1,000 customers, and the API answers 1,000 rows a request, so
// the end of the alphabet was missing from every phone.
//
// What these hold: the list is read a page at a time until the last, the
// same name sorts the same way every time, the picker offers a new customer
// under a search that matched, and a customer with a name already on the list
// is added when the rep goes ahead.

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
import 'package:gf_merch_rep/features/visit/store_picker_screen.dart';

const _json = {'content-type': 'application/json'};

/// Ids that sort as their number does, as uuids sort as text.
String _id(int n) => 'store-${n.toString().padLeft(5, '0')}';

StoreSummary _store(String id, String name, {String? city}) =>
    StoreSummary(id: id, name: name, city: city, geofenceRadiusM: 100);

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

void main() {
  late AppDatabase db;

  setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  group('the customer list', () {
    late List<http.Request> requests;
    SupabaseClient? client;

    tearDown(() async {
      await client?.dispose();
      client = null;
    });

    /// A server holding [count] active customers, answering as PostgREST
    /// does: `id=gt.<id>`, `order=id.asc`, at most `limit` rows and never
    /// more than 1,000.
    RouteRepository serverWith(int count, {int maxRows = 1000}) {
      requests = [];
      final all = [
        for (var n = 1; n <= count; n++)
          {'id': _id(n), 'name': 'Shop ${count - n}', 'geofence_radius_m': 100},
      ];
      client = SupabaseClient(
        'http://localhost:54321',
        'anon-key',
        httpClient: MockClient((request) async {
          requests.add(request);
          final q = request.url.queryParameters;
          final after = q['id']?.replaceFirst('gt.', '');
          final limit = int.parse(q['limit'] ?? '1000');
          final rows = all
              .where((r) => after == null || (r['id'] as String).compareTo(after) > 0)
              .take(limit < maxRows ? limit : maxRows)
              .toList();
          return http.Response(jsonEncode(rows), 200, headers: _json, request: request);
        }),
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      return RouteRepository(client!, db);
    }

    test('reads past the 1,000 rows one request returns', () async {
      final stores = await serverWith(2050).fetchStores();

      expect(stores, hasLength(2050));
      expect(stores.map((s) => s.id).toSet(), hasLength(2050));
      expect(requests, hasLength(3));
      expect(requests.first.url.queryParameters.containsKey('id'), isFalse);
      expect(requests[1].url.queryParameters['id'], 'gt.${_id(1000)}');
      expect(requests[2].url.queryParameters['id'], 'gt.${_id(2000)}');
      for (final r in requests) {
        expect(r.url.queryParameters['order'], startsWith('id.asc'));
        expect(r.url.queryParameters['limit'], '$kStorePageSize');
        expect(r.url.queryParameters['active'], 'eq.true');
      }
      // Shown A–Z, whatever order the pages came in.
      final names = stores.map((s) => s.name.toLowerCase()).toList();
      expect(names, orderedEquals([...names]..sort()));
    });

    test('a list of exactly one page asks once more and stops', () async {
      expect(await serverWith(1000).fetchStores(), hasLength(1000));
      expect(requests, hasLength(2));
    });

    test('a short list is one request; one a round hundred long asks once more', () async {
      expect(await serverWith(12).fetchStores(), hasLength(12));
      expect(requests, hasLength(1));
      expect(await serverWith(300).fetchStores(), hasLength(300));
      expect(requests, hasLength(2));
    });

    test('a server that answers fewer rows than asked for is still read to the end', () async {
      expect(await serverWith(1234, maxRows: 500).fetchStores(), hasLength(1234));
      expect(requests, hasLength(3));
    });

    test('the last page is an empty one, or one shorter than the page before', () {
      expect(isLastPage(0, previous: null), isTrue);
      expect(isLastPage(12, previous: null), isTrue);
      expect(isLastPage(500, previous: null), isFalse);
      expect(isLastPage(500, previous: 500), isFalse);
      expect(isLastPage(499, previous: 500), isTrue);
    });

    test('offline, the whole saved list comes back', () async {
      await serverWith(1500).fetchStores();
      await client!.dispose();
      client = SupabaseClient(
        'http://localhost:54321',
        'anon-key',
        httpClient: MockClient((r) async => http.Response('offline', 503, request: r)),
        authOptions: const AuthClientOptions(autoRefreshToken: false),
      );
      expect(await RouteRepository(client!, db).fetchStores(), hasLength(1500));
    });
  });

  test('the same name sorts by where it is, the same way every time', () {
    final stores = [
      _store('b', 'Double Store', city: 'Pelican Park'),
      _store('c', 'apple Café'),
      _store('a', 'Double Store', city: 'Phumlani'),
      _store('d', 'double store', city: 'Pelican Park'),
    ];
    final once = sortedByName(stores).map((s) => s.id).toList();
    final again = sortedByName(stores.reversed).map((s) => s.id).toList();
    expect(once, ['c', 'b', 'd', 'a']);
    expect(again, once);
  });

  test('a search becomes the start of a name', () {
    expect(initialCustomerName('  double   store '), 'Double Store');
    expect(initialCustomerName('KFC Mitchells Plain'), 'KFC Mitchells Plain');
    expect(initialCustomerName(null), '');
  });

  group('on the phone', () {
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

    final existing = [
      _store('s1', 'Double Store', city: 'Pelican Park'),
      _store('s2', 'Double Store', city: 'Phumlani'),
      _store('s3', 'Lansdowne Food Center', city: 'Lansdowne'),
    ];

    Future<GoRouter> open(WidgetTester tester, String start) async {
      final router = GoRouter(
        initialLocation: start,
        routes: [
          GoRoute(
            path: '/unscheduled/order',
            builder: (_, _) => const StorePickerScreen(forOrder: true),
          ),
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
          storesProvider.overrideWith((ref) async => existing),
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
      return router;
    }

    final site = Terms.defaults.site;

    testWidgets('a search that matches still offers a new one, named as searched',
        (tester) async {
      final router = await open(tester, '/unscheduled/order');

      // No search: the whole list, and no button in the way.
      expect(find.text('Add a new ${site.oneLower}'), findsNothing);

      await tester.enterText(find.byType(TextField), 'double store');
      await tester.pump();
      expect(find.text('Double Store'), findsNWidgets(2));
      await tester.tap(find.text('Add a new ${site.oneLower}'));
      // Pumped by hand: the search field keeps its cursor blinking.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(router.routeInformationProvider.value.uri.path, '/unscheduled/order/new');
      final name = tester.widget<TextField>(
          find.widgetWithText(TextField, 'Name of the ${site.oneLower}'));
      // Tidied for a name, and selected so the rep can type over it.
      expect(name.controller?.text, 'Double Store');
      expect(name.controller?.selection.textInside(name.controller!.text), 'Double Store');
      // Both shops already called that are shown, each with where it is.
      expect(find.textContaining('in Pelican Park is on your list already'), findsOneWidget);
      expect(find.textContaining('in Phumlani is on your list already'), findsOneWidget);
      expect(find.textContaining('Not one of these?'), findsOneWidget);
    });

    testWidgets('a name already on the list is added when the rep goes ahead', (tester) async {
      await open(tester, '/unscheduled/order/new');

      await tester.enterText(find.widgetWithText(TextField, 'Name of the ${site.oneLower}'), 'Double Store');
      await tester.pump();
      expect(find.text('Use that ${site.oneLower}'), findsNWidgets(2));

      await tester.enterText(find.widgetWithText(TextField, 'Delivery address'), '12 Klip Road');
      await tester.enterText(find.widgetWithText(TextField, 'Contact person'), 'Mr Adams');
      await tester.enterText(find.widgetWithText(TextField, 'Contact number'), '0821234567');
      await tester.pump();
      await tester.scrollUntilVisible(
        find.text('Add and continue'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text('Add and continue'));
      // The database answers in real time, the screen in test time: let both
      // run until the customer is saved and the order screen is up.
      for (var i = 0; i < 20 && find.textContaining('Order for').evaluate().isEmpty; i++) {
        await tester.pump();
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      }
      await tester.pumpAndSettle();

      final added = (await tester.runAsync(db.pendingEntries))!
          .where((e) => e.entityType == OutboxType.storeAdd)
          .toList();
      expect(added, hasLength(1));
      expect(jsonDecode(added.single.payload)['name'], 'Double Store');
      expect(['s1', 's2'], isNot(contains(added.single.clientGeneratedId)));
      expect(find.text('Order for ${added.single.clientGeneratedId}'), findsOneWidget);
    });

    testWidgets('using the one already on the list adds nothing', (tester) async {
      await open(tester, '/unscheduled/order/new?name=Lansdowne%20Food%20Center');

      await tester.tap(find.text('Use that ${site.oneLower}'));
      await tester.pumpAndSettle();

      expect(find.text('Order for s3'), findsOneWidget);
      expect(await tester.runAsync(db.pendingEntries), isEmpty);
    });
  });
}
