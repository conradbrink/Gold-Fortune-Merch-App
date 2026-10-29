// A new order: one the customer sent the rep (WhatsApp, a call, an email)
// rather than gave them standing in the shop. Owner, 29 Oct 2026: it lives
// under the day's "+ New" button, needs no visit, no check-in and no open
// workday, and nobody signs — the rep says how it came instead.
//
// What these hold: the order is queued with no visit and with how it came, its
// draft is the rep's own and is cleared with it, nothing records it as taken
// on a visit, the server is sent `received_via` and no signature, and the
// screen asks how they ordered before it will save, with no sign sheet.

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
import 'package:gf_merch_rep/data/local/order_draft.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/catalogue_product.dart';
import 'package:gf_merch_rep/data/models/order_received_via.dart';
import 'package:gf_merch_rep/data/models/profile.dart';
import 'package:gf_merch_rep/data/repositories/order_repository.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:gf_merch_rep/features/orders/order_capture_screen.dart';
import 'package:gf_merch_rep/features/visit/new_customer_screen.dart';
import 'package:gf_merch_rep/features/visit/unscheduled_chooser_screen.dart';

/// `submitOrder` ends with `unawaited(_sync.sync())`; nothing here should
/// reach for the network.
class _SilentSync extends SyncEngine {
  _SilentSync(AppDatabase db)
      : super(db, SupabaseClient('http://localhost:1', 'test-anon-key'));

  @override
  Future<void> sync() async {}
}

/// A phone with signal: whatever is queued reaches the server at once.
class _LandingSync extends SyncEngine {
  _LandingSync(this.db)
      : super(
          db,
          SupabaseClient(
            'http://localhost:1',
            'test-anon-key',
            authOptions: const AuthClientOptions(autoRefreshToken: false),
          ),
        );

  final AppDatabase db;

  @override
  Future<void> sync() async {
    for (final e in await db.pendingEntries()) {
      await db.deleteEntry(e.id);
    }
  }
}

const _line = OrderDraftLine(productId: 'p1', qty: 3, unitsPerShrink: 10);

void main() {
  late AppDatabase db;
  late OrderRepository repo;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = OrderRepository(
      SupabaseClient('http://localhost:1', 'test-anon-key'),
      db,
      _SilentSync(db),
    );
  });

  tearDown(() async => db.close());

  group('the draft', () {
    test('is kept per person and customer', () {
      expect(OrderDraft.newOrderId('rep-1', 'store-1'),
          isNot(OrderDraft.newOrderId('rep-2', 'store-1')),
          reason: 'somebody else on a shared phone must not find it');
      expect(OrderDraft.newOrderId('rep-1', 'store-1'),
          isNot(OrderDraft.newOrderId('rep-1', 'store-2')));
      expect(OrderDraft.newOrderId('rep-1', 'store-1'),
          OrderDraft.newOrderId('rep-1', 'store-1'),
          reason: 'choosing the same customer again brings it back');
    });

    test('remembers how they ordered, and old drafts read without it', () async {
      final id = OrderDraft.newOrderId('rep-1', 'store-1');
      await repo.drafts.save(
        id,
        const OrderDraft(storeId: 'store-1', lines: [_line], receivedVia: 'whatsapp'),
      );
      expect((await repo.drafts.load(id))!.receivedVia, 'whatsapp');

      // A draft written by the build before this one, taken in the shop.
      final old = jsonDecode(
        const OrderDraft(storeId: 'store-1', lines: [_line]).encode(),
      ) as Map<String, dynamic>
        ..remove('received_via');
      expect(OrderDraft.decode(jsonEncode(old))!.receivedVia, isNull);
    });
  });

  group('submitOrder', () {
    test('queues a new order with no visit and how it came', () async {
      final draftId = OrderDraft.newOrderId('rep-1', 'store-1');
      await repo.drafts.save(
        draftId,
        const OrderDraft(storeId: 'store-1', lines: [_line], receivedVia: 'phone'),
      );

      final clientId = await repo.submitOrder(
        orgId: 'org-1',
        repId: 'rep-1',
        storeId: 'store-1',
        draftId: draftId,
        receivedVia: 'phone',
        contactName: 'Mma Dintwe',
        contactPhone: '0821234567',
        deliveryAddress: '12 Main Road, Mahikeng',
        lines: const [_line],
      );

      final queued = (await db.pendingEntries()).single;
      expect(queued.entityType, OutboxType.orderCreate);
      expect(queued.clientGeneratedId, clientId);
      final payload = jsonDecode(queued.payload) as Map<String, dynamic>;
      expect(payload['received_via'], 'phone');
      expect(payload['source'], 'rep_app');
      expect(payload['rep_id'], 'rep-1', reason: 'whose work it is on a shared phone');
      expect(payload['visit_client_generated_id'], isNull);
      expect(payload['local_signature_path'], isNull);
      expect(payload['signed_by_name'], isNull);
      expect((payload['lines'] as List).single['qty_ordered'], 30);

      expect(await repo.drafts.load(draftId), isNull,
          reason: 'cleared with the queueing, or it could be sent twice');
      expect(await repo.visitsWithOrderTaken(), isEmpty,
          reason: 'no visit took it, so no stop on the day should say so');
    });

    test('an order taken in the shop is still a visit order', () async {
      await repo.submitOrder(
        orgId: 'org-1',
        repId: 'rep-1',
        storeId: 'store-1',
        visitClientGeneratedId: 'visit-1',
        lines: const [_line],
      );
      final payload =
          jsonDecode((await db.pendingEntries()).single.payload) as Map<String, dynamic>;
      expect(payload['received_via'], orderTakenInShop);
      expect(payload['visit_client_generated_id'], 'visit-1');
      expect(await repo.visitsWithOrderTaken(), {'visit-1'});
    });

    test('refuses an order that is neither taken in the shop nor says how it came', () async {
      Future<void> submit({String? visit, String? draft, String via = orderTakenInShop}) =>
          repo.submitOrder(
            orgId: 'org-1',
            repId: 'rep-1',
            storeId: 'store-1',
            visitClientGeneratedId: visit,
            draftId: draft,
            receivedVia: via,
            lines: const [_line],
          );

      // No visit and nothing said: the office could not tell it apart from a
      // shop order.
      await expectLater(submit(draft: 'd'), throwsArgumentError);
      // A value the database would refuse, so it would sit in the outbox.
      await expectLater(submit(draft: 'd', via: 'sms'), throwsArgumentError);
      // A visit order claiming to be a WhatsApp.
      await expectLater(submit(visit: 'visit-1', via: 'whatsapp'), throwsArgumentError);
      // Nowhere to clear the draft from.
      await expectLater(submit(via: 'email'), throwsArgumentError);

      expect(await db.pendingEntries(), isEmpty);
    });
  });

  test('the choices are values the database allows', () {
    // orders_received_via_check (20260802164130_create_orders.sql).
    const allowed = {'rep_visit', 'whatsapp', 'email', 'phone', 'in_person', 'other'};
    for (final c in orderSentChoices) {
      expect(allowed, contains(c.value));
    }
    expect(orderSentChoices.map((c) => c.value), isNot(contains(orderTakenInShop)));
  });

  test('the server is sent how it came, and no signature', () async {
    final requests = <http.Request>[];
    http.Response ok(http.Request r, Object body, [int status = 200]) =>
        http.Response(jsonEncode(body), status,
            headers: const {'content-type': 'application/json'}, request: r);
    final client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((r) async {
        requests.add(r);
        final path = r.url.path;
        if (path.endsWith('/orders') && r.method == 'GET') return ok(r, []);
        if (path.endsWith('/rpc/next_document_number')) return ok(r, 'SO-000201');
        if (path.endsWith('/orders') && r.method == 'POST') return ok(r, {'id': 'order-new'}, 201);
        if (path.endsWith('/order_lines')) return ok(r, [], 201);
        return http.Response('unexpected $path', 500, request: r);
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    addTearDown(client.dispose);

    await repo.submitOrder(
      orgId: 'org-1',
      repId: 'rep-1',
      storeId: 'store-1',
      draftId: OrderDraft.newOrderId('rep-1', 'store-1'),
      receivedVia: 'whatsapp',
      contactName: 'Mma Dintwe',
      contactPhone: '0821234567',
      deliveryAddress: '12 Main Road, Mahikeng',
      lines: const [_line],
    );
    await SyncEngine(db, client, readBuild: () async => null, signedInUser: () => 'rep-1').sync();

    expect(await db.pendingEntries(), isEmpty, reason: 'it landed');
    final insert = requests.singleWhere(
        (r) => r.url.path.endsWith('/orders') && r.method == 'POST');
    final body = jsonDecode(insert.body) as Map<String, dynamic>;
    expect(body['received_via'], 'whatsapp');
    expect(body['source'], 'rep_app');
    expect(body['rep_id'], 'rep-1');
    expect(body.containsKey('signature_path'), isFalse);
    expect(body.containsKey('signed_by_name'), isFalse);
    expect(requests.where((r) => r.url.path.contains('/storage/')), isEmpty,
        reason: 'there is no signature to upload');
  });

  group('the screen', () {
    Future<void> openNewOrder(WidgetTester tester) async {
      await tester.runAsync(() async {
        await db.setValue(
          'catalogue_products',
          jsonEncode([
            const CatalogueProduct(id: 'p1', name: 'Rooibos 80s', unitsPerShrink: 10).toMap(),
          ]),
        );
      });
      final router = GoRouter(
        initialLocation: '/order',
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => const Scaffold(body: Text('Today')),
            routes: [
              GoRoute(
                path: 'order',
                builder: (_, _) => OrderCaptureScreen.newOrder(
                  draftId: OrderDraft.newOrderId('rep-1', 'store-1'),
                  storeId: 'store-1',
                  storeName: 'Batho Superette',
                  storeAddress: '12 Main Road, Mahikeng',
                ),
              ),
            ],
          ),
        ],
      );
      addTearDown(router.dispose);
      // A phone's screen, so the whole bottom panel is on it.
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final container = ProviderContainer(
        overrides: [
          termsProvider.overrideWithValue(Terms.defaults),
          orderRepositoryProvider.overrideWithValue(repo),
          routeRepositoryProvider.overrideWithValue(
            // No token refresh: its timer would outlive the test.
            RouteRepository(
              SupabaseClient(
                'http://localhost:1',
                'test-anon-key',
                authOptions: const AuthClientOptions(autoRefreshToken: false),
              ),
              db,
            ),
          ),
          profileProvider.overrideWith(
            (ref) async => const Profile(id: 'rep-1', orgId: 'org-1', role: 'rep'),
          ),
          storeReorderProvider.overrideWith((ref) async => const {}),
        ],
      );
      addTearDown(container.dispose);
      // Read already, as it is in the app by the time an order is typed.
      await tester.runAsync(() => container.read(profileProvider.future));
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ));
      // The draft and the catalogue are read from the database.
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pump();
    }

    Future<void> fillContact(WidgetTester tester) async {
      await tester.enterText(find.widgetWithText(TextField, 'Who placed it'), 'Mma Dintwe');
      await tester.enterText(find.widgetWithText(TextField, 'Their phone'), '0821234567');
    }

    testWidgets('asks how they ordered, and saves with no signature', (tester) async {
      await openNewOrder(tester);

      expect(find.text('New order'), findsOneWidget);
      expect(find.text('Take an order'), findsNothing);
      expect(find.text('How they ordered'), findsOneWidget);
      for (final c in orderSentChoices) {
        expect(find.widgetWithText(ChoiceChip, c.label), findsOneWidget);
      }
      expect(find.text('Sign and save'), findsNothing);

      await tester.tap(find.byIcon(Icons.add_circle_outline));
      await fillContact(tester);
      await tester.pump();

      // Nothing chosen: no order, and the rep is told why.
      await tester.tap(find.text('Save order'));
      await tester.pump();
      expect(find.text('Choose how they ordered before saving.'), findsOneWidget);
      expect(await tester.runAsync(db.pendingEntries), isEmpty);

      await tester.tap(find.widgetWithText(ChoiceChip, 'WhatsApp'));
      await tester.pump();
      expect(find.text('Choose how they ordered before saving.'), findsNothing);

      await tester.tap(find.text('Save order'));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();

      // Straight to the day: no sign sheet came up on the way.
      expect(find.text('Today'), findsOneWidget);
      final queued = (await tester.runAsync(db.pendingEntries))!.single;
      final payload = jsonDecode(queued.payload) as Map<String, dynamic>;
      expect(payload['received_via'], 'whatsapp');
      expect(payload['visit_client_generated_id'], isNull);
      expect(payload['signed_by_name'], isNull);
      expect(payload['delivery_address'], '12 Main Road, Mahikeng');
      // Nothing was sent: "when you have signal" is the truth here.
      expect(
        find.text('Order saved. It will reach the warehouse when you have signal.'),
        findsOneWidget,
      );
    });

    testWidgets('sent straight away, the rep is not told to wait for signal', (tester) async {
      repo = OrderRepository(
        SupabaseClient(
          'http://localhost:1',
          'test-anon-key',
          authOptions: const AuthClientOptions(autoRefreshToken: false),
        ),
        db,
        _LandingSync(db),
      );
      await openNewOrder(tester);
      await tester.tap(find.byIcon(Icons.add_circle_outline));
      await fillContact(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'WhatsApp'));
      await tester.pump();

      await tester.tap(find.text('Save order'));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
      await tester.pumpAndSettle();

      expect(find.text('Today'), findsOneWidget);
      expect(await tester.runAsync(db.pendingEntries), isEmpty, reason: 'it landed');
      expect(find.text('Order sent to the warehouse.'), findsOneWidget);
      expect(find.textContaining('when you have signal'), findsNothing);
    });

    testWidgets('a new order left unsaved yesterday is not filled in today', (tester) async {
      final id = OrderDraft.newOrderId('rep-1', 'store-1');
      await tester.runAsync(() => repo.drafts.save(
            id,
            OrderDraft(
              storeId: 'store-1',
              lines: const [_line],
              receivedVia: 'whatsapp',
              savedAt: DateTime.now().subtract(const Duration(days: 1)),
            ),
          ));

      await openNewOrder(tester);

      expect(find.text('0 lines'), findsOneWidget,
          reason: 'the shop has sent another order since; the old lines would go again');
      final chip = tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'WhatsApp'));
      expect(chip.selected, isFalse);
      expect(await tester.runAsync(() => repo.drafts.load(id)), isNull);
    });

    testWidgets('how they ordered survives the app being closed', (tester) async {
      await openNewOrder(tester);
      await tester.tap(find.widgetWithText(ChoiceChip, 'Email'));
      await tester.tap(find.byIcon(Icons.add_circle_outline));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));

      final draft = await tester.runAsync(
        () => repo.drafts.load(OrderDraft.newOrderId('rep-1', 'store-1')),
      );
      expect(draft!.receivedVia, 'email');
      expect(draft.lines.single.qty, 1);
    });
  });

  testWidgets('a customer added for a new order takes no position and goes on to the order',
      (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        termsProvider.overrideWithValue(Terms.defaults),
        storesProvider.overrideWith((ref) async => const []),
        storeGroupsProvider.overrideWith((ref) async => const []),
      ],
      child: const MaterialApp(home: NewCustomerScreen(forOrder: true)),
    ));
    await tester.pump();

    // Where the rep is standing is not where the shop is.
    expect(find.textContaining('GPS'), findsNothing);
    expect(find.textContaining('position'), findsNothing);
    expect(find.text('Add and continue'), findsOneWidget);
    expect(find.textContaining('You type the order in next.'), findsOneWidget);
  });

  group('the "+ New" screen', () {
    Future<void> openChooser(WidgetTester tester, Set<String> modules) async {
      await tester.pumpWidget(ProviderScope(
        overrides: [
          termsProvider.overrideWithValue(Terms.defaults),
          companyConfigValueProvider.overrideWithValue(CompanyConfig(
            modules: modules,
            pingInterval: CompanyConfig.fallback.pingInterval,
            shortVisit: CompanyConfig.fallback.shortVisit,
            autoEnd: CompanyConfig.fallback.autoEnd,
            checkinRadiusM: 100,
          )),
          myLeadsProvider.overrideWith((ref) async => const []),
        ],
        child: const MaterialApp(home: UnscheduledChooserScreen()),
      ));
      await tester.pump();
    }

    testWidgets('offers a new order beside a visit, a new customer and a sales call', (tester) async {
      // Every label one to three words (owner, 29 Oct 2026).
      await openChooser(tester, {'core', 'distribution'});

      expect(find.text('New'), findsOneWidget);
      const t = Terms.defaults;
      final titles = [
        '${t.site.one} ${t.job.oneLower}',
        'New order',
        'New ${t.site.oneLower}',
        'Sales ${t.job.oneLower}',
      ];
      for (final t in titles) {
        expect(find.text(t), findsOneWidget);
        expect(t.split(' ').length, lessThanOrEqualTo(3), reason: '"$t" is too long for a label');
      }
      // In the order the owner chose.
      final ys = [for (final t in titles) tester.getTopLeft(find.text(t)).dy];
      expect(ys, orderedEquals([...ys]..sort()));
    });

    testWidgets('no new order without the orders module', (tester) async {
      await openChooser(tester, {'core'});

      expect(find.text('${Terms.defaults.site.one} ${Terms.defaults.job.oneLower}'), findsOneWidget);
      expect(find.text('New order'), findsNothing);
    });
  });
}
