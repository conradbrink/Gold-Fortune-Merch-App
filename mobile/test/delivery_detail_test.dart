// A delivery a rep has been given can be opened: where it is going, who to
// ask for and what is in it (the products from `delivery_contents()`). This
// pins how the phone reads what comes back and what the screens do with it.
//
// No Supabase client: the repository is a fake, and the providers the screens
// read are the real ones over it, so the no-retry rule and the dispose-on-close
// rule are the shipped ones.

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/providers.dart';
import 'package:gf_merch_rep/core/terms.dart';
import 'package:gf_merch_rep/data/models/delivery.dart';
import 'package:gf_merch_rep/data/models/profile.dart';
import 'package:gf_merch_rep/data/repositories/delivery_repository.dart';
import 'package:gf_merch_rep/features/deliveries/deliveries_screen.dart';
import 'package:gf_merch_rep/features/deliveries/delivery_detail_screen.dart';
import 'package:gf_merch_rep/shared/widgets/signature_pad.dart';

/// A dispatch as PostgREST returns it for the delivery screen's select.
Map<String, dynamic> _dispatch({
  String id = 'd1',
  String status = 'in_transit',
  String? deliveryAddress,
  String? address = '12 Main Road',
  String? city = 'Gaborone',
  String? state,
  double? lat = -24.6282,
  double? lng = 25.9231,
  String? notes = 'Please deliver only when there is stock for all products.',
  String? phone,
  String? contact,
  String? poExpires,
  String? tracking,
  String? carrier,
  String dispatchedAt = '2026-10-22T07:15:00+00:00',
}) => {
  'id': id,
  'dispatch_number': 'DSP-000209',
  'status': status,
  'dispatched_at': dispatchedAt,
  'expected_delivery_on': '2026-10-23',
  'delivered_at': status == 'delivered' ? '2026-10-23T09:40:00+00:00' : null,
  'carrier_name': carrier,
  'tracking_reference': tracking,
  'notes': null,
  'failure_reason': null,
  'received_by_name': status == 'delivered' ? 'K. Molefe' : null,
  'order_id': 'o1',
  'order': {
    'order_number': 'SO-001234',
    'customer_po_number': 'PO-4471',
    'customer_po_expires_on': poExpires,
    'contact_name': contact,
    'contact_phone': phone,
    'delivery_address': deliveryAddress,
    'notes': notes,
    'store': {
      'name': 'Main Road Superette',
      'address': address,
      'city': city,
      'state': state,
      'zip': null,
      'lat': lat,
      'lng': lng,
    },
  },
};

/// `delivery_contents()` rows: one per order line, no price.
final _lines = [
  {
    'product_name': 'Mango Ice 12000',
    'brand': 'Acme',
    'sku_code': 'AC-12K-MI',
    'units_per_shrink': 10,
    'qty': 10,
    'qty_ordered': 10,
    'qty_delivered': 0,
    'qty_returned': 0,
  },
  {
    'product_name': 'Grape Ice 800',
    'brand': null,
    'sku_code': null,
    'units_per_shrink': 10,
    'qty': 7,
    'qty_ordered': 30,
    'qty_delivered': 0,
    'qty_returned': 0,
  },
];

DeliveryDetail _detail([
  Map<String, dynamic>? dispatch,
  List<dynamic>? lines,
]) => DeliveryDetail.fromMaps(dispatch ?? _dispatch(), lines ?? _lines);

class _FakeRepository implements DeliveryRepository {
  _FakeRepository({
    this.list = const [],
    Future<DeliveryDetail?> Function()? detail,
  }) : detail = detail ?? (() async => _detail());

  List<Delivery> list;
  Future<DeliveryDetail?> Function() detail;
  int listCalls = 0;
  int detailCalls = 0;

  @override
  Future<List<Delivery>> myDeliveries() async {
    listCalls++;
    return list;
  }

  @override
  Future<DeliveryDetail?> delivery(String dispatchId) {
    detailCalls++;
    return detail();
  }

  @override
  Future<int> outstandingCount() async =>
      list.where((d) => d.isOutstanding).length;

  /// Dispatches recorded as delivered on "this phone" and not yet sent.
  Set<String> pending = {};
  int confirmCalls = 0;

  @override
  Future<Set<String>> pendingConfirms() async => pending;

  @override
  Future<void> confirmDelivery({
    required String orgId,
    required String repId,
    required DeliveryDetail delivery,
    required String receivedBy,
    required Uint8List signature,
    File? photo,
  }) async {
    confirmCalls++;
    pending = {...pending, delivery.delivery.id};
    if (photo != null) withPhoto = {...withPhoto, delivery.delivery.id};
  }

  /// Of [pending], the ones queued with a photo of the delivery note.
  Set<String> withPhoto = {};

  @override
  Future<bool> queuedWithPhoto(String dispatchId) async =>
      withPhoto.contains(dispatchId);

  /// What sending the drop comes to; "this phone" has signal unless told.
  DropOutcome outcome = DropOutcome.delivered;
  int sendCalls = 0;

  @override
  Future<DropOutcome> sendDrop(String dispatchId) async {
    sendCalls++;
    if (outcome != DropOutcome.waiting) pending = {...pending}..remove(dispatchId);
    return outcome;
  }
}

Widget _scope(_FakeRepository repo, Widget app) => ProviderScope(
  // A fresh scope each pump, or a second pump keeps the first answers.
  key: UniqueKey(),
  overrides: [
    currentUserProvider.overrideWithValue(null),
    deliveryRepositoryProvider.overrideWithValue(repo),
    // The real one reads the outbox; here the fake's set is the outbox.
    pendingDeliveryConfirmsProvider.overrideWith((ref) => repo.pendingConfirms()),
    queuedDeliveryPhotoProvider.overrideWith((ref, id) => repo.queuedWithPhoto(id)),
    profileProvider.overrideWith(
      (ref) async => const Profile(id: 'driver-1', orgId: 'org-1', role: 'driver'),
    ),
    companyConfigValueProvider.overrideWithValue(CompanyConfig.fallback),
    termsProvider.overrideWithValue(Terms.defaults),
  ],
  child: app,
);

Future<_FakeRepository> _pumpDetail(
  WidgetTester tester, {
  DeliveryDetail? detail,
  Future<DeliveryDetail?> Function()? fetch,
  Set<String> pending = const {},
  Set<String> withPhoto = const {},
  DropOutcome outcome = DropOutcome.delivered,
}) async {
  final repo = _FakeRepository(detail: fetch ?? (() async => detail))
    ..pending = pending
    ..withPhoto = withPhoto
    ..outcome = outcome;
  await tester.pumpWidget(
    _scope(
      repo,
      const MaterialApp(home: DeliveryDetailScreen(dispatchId: 'd1')),
    ),
  );
  await tester.pumpAndSettle();
  return repo;
}

/// The app's shape: `/deliveries` and its `:dispatchId` child under `/`.
GoRouter _router() => GoRouter(
  initialLocation: '/deliveries',
  routes: [
    GoRoute(
      path: '/',
      builder: (_, _) => const Text('HOME'),
      routes: [
        GoRoute(
          path: 'deliveries',
          builder: (_, _) => const DeliveriesScreen(),
          routes: [
            GoRoute(
              path: ':dispatchId',
              builder: (_, state) => DeliveryDetailScreen(
                dispatchId: state.pathParameters['dispatchId']!,
              ),
            ),
          ],
        ),
      ],
    ),
  ],
);

String _isoDate(DateTime d) =>
    '${d.year}-'
    '${'${d.month}'.padLeft(2, '0')}-${'${d.day}'.padLeft(2, '0')}';

void main() {
  group('reading a delivery', () {
    test('the dispatch, its order, the place and the products', () {
      final d = _detail();
      expect(d.delivery.storeName, 'Main Road Superette');
      expect(d.delivery.orderNumber, 'SO-001234');
      expect(d.poNumber, 'PO-4471');
      expect(d.orderNotes, startsWith('Please deliver only'));
      expect(d.lines!.map((l) => l.productName), [
        'Mango Ice 12000',
        'Grape Ice 800',
      ]);
      // The counts are the products', from the same rows.
      expect(d.delivery.units, 17);
      expect(d.delivery.lineCount, 2);
    });

    test('products that could not be loaded are not "none"', () {
      final d = DeliveryDetail.fromMaps(_dispatch(), null);
      expect(d.lines, isNull);
      expect(d.delivery.storeName, 'Main Road Superette');
    });

    test('blank text reads as nothing', () {
      final d = _detail(
        _dispatch(
          notes: '  ',
          deliveryAddress: '',
          tracking: '   ',
          carrier: '',
          address: ' ',
        ),
      );
      expect(d.orderNotes, isNull);
      expect(d.deliveryAddress, isNull);
      expect(d.delivery.trackingReference, isNull);
      expect(d.delivery.carrier, isNull);
      expect(d.delivery.storeAddress, isNull);
    });

    test("times are on the phone's clock; a due date stays a date", () {
      final d = _detail(_dispatch(dispatchedAt: '2026-10-22T23:30:00+00:00'));
      expect(d.delivery.dispatchedAt.isUtc, isFalse);
      expect(
        d.delivery.dispatchedAt,
        DateTime.parse('2026-10-22T23:30:00+00:00').toLocal(),
      );
      expect(d.delivery.expectedOn, DateTime(2026, 10, 23));
      final listed = Delivery.fromMap(_dispatch(status: 'delivered'));
      expect(listed.deliveredAt!.isUtc, isFalse);
    });

    test('a product short of what was ordered', () {
      final lines = _detail().lines!;
      expect(lines.first.shortBy, 0);
      expect(lines.last.shortBy, 23);
    });

    test('whole shrinks only', () {
      DeliveryLine line(int qty, int? per) => DeliveryLine.fromMap({
        'product_name': 'X',
        'qty': qty,
        'units_per_shrink': per,
      });
      expect(line(10, 10).inShrinks, '1 shrink');
      expect(line(30, 10).inShrinks, '3 shrinks');
      expect(line(7, 10).inShrinks, isNull);
      expect(line(10, null).inShrinks, isNull);
      expect(line(10, 1).inShrinks, isNull);
      expect(line(0, 10).inShrinks, isNull);
    });
  });

  group('where it goes', () {
    test('the address as the other screens write a place', () {
      expect(_detail().address, '12 Main Road, Gaborone');
      expect(
        _detail(_dispatch(state: 'South-East')).address,
        '12 Main Road, Gaborone, South-East',
      );
      expect(_detail(_dispatch(address: null)).address, 'Gaborone');
      expect(_detail(_dispatch(address: null, city: null)).address, isNull);
    });

    test('an address typed on the order wins, for directions too', () {
      final d = _detail(_dispatch(deliveryAddress: 'Back gate, Plot 99'));
      expect(d.address, 'Back gate, Plot 99');
      expect(
        d.directions()!.queryParameters['destination'],
        'Back gate, Plot 99',
      );
    });

    test('directions go to the pin when there is one', () {
      final uri = _detail().directions()!;
      expect(uri.host, 'www.google.com');
      expect(uri.path, '/maps/dir/');
      expect(uri.queryParameters['destination'], '-24.6282,25.9231');
    });

    // web/lib/maps.ts mapsQuery, and its tests in web/tests/maps.test.ts.
    test('with no pin, the place is found as the web finds it', () {
      String? to(Map<String, dynamic> m, {bool byName = true}) =>
          _detail(m).directions(byName: byName)?.queryParameters['destination'];
      final noPin = _dispatch(lat: null, lng: null, address: 'Game City');
      expect(to(noPin), 'Main Road Superette, Game City, Gaborone');
      expect(to(noPin, byName: false), 'Game City, Gaborone');
      final noStreet = _dispatch(lat: null, lng: null, address: null);
      expect(to(noStreet, byName: false), 'Main Road Superette, Gaborone');
      final nothing = _dispatch(
        lat: null,
        lng: null,
        address: null,
        city: null,
      );
      expect(to(nothing), 'Main Road Superette');
    });
  });

  group('the number to dial', () {
    String? dial(String? typed) =>
        _detail(_dispatch(phone: typed)).dial?.toString();

    test('as typed, in its common shapes', () {
      expect(dial('+267 71 234 567'), 'tel:+26771234567');
      expect(dial('(+267) 71 234 567'), 'tel:+26771234567');
      expect(dial('Tel: +267 71 234 567'), 'tel:+26771234567');
      expect(dial('+27 (0)82 123 4567'), 'tel:+27821234567');
      expect(dial('071-234-5678'), 'tel:0712345678');
    });

    test('the first of several, and never an extension', () {
      expect(dial('71 234 567 / 72 345 678'), 'tel:71234567');
      expect(dial('082 123 4567 ext 12'), 'tel:0821234567');
      expect(dial('71234567 or 72345678'), 'tel:71234567');
    });

    test('nothing to dial', () {
      expect(dial(null), isNull);
      expect(dial('n/a'), isNull);
      expect(dial('none'), isNull);
      expect(dial('123'), isNull);
    });
  });

  group('the PO, as the web order board says it', () {
    final today = DateTime(2026, 10, 22, 15, 30);
    String? words(String? expires) =>
        _detail(_dispatch(poExpires: expires)).poExpiry(today)?.words;

    test('each stage', () {
      expect(words(null), isNull);
      expect(words('2026-10-21'), 'PO expired on 21 Oct');
      expect(words('2026-10-22'), 'PO expires today');
      expect(words('2026-10-23'), 'PO expires tomorrow');
      expect(words('2026-10-24'), 'PO expires in 2 days, on 24 Oct');
      expect(words('2026-10-30'), 'PO valid until 30 Oct');
    });

    test('urgency', () {
      PoUrgency? u(String e) =>
          _detail(_dispatch(poExpires: e)).poExpiry(today)?.urgency;
      expect(u('2026-10-21'), PoUrgency.lapsed);
      expect(u('2026-10-24'), PoUrgency.soon);
      expect(u('2026-10-25'), PoUrgency.calm);
    });
  });

  group('the delivery screen', () {
    testWidgets('shows where it goes and what is in it', (tester) async {
      await _pumpDetail(tester, detail: _detail());

      expect(find.text('Main Road Superette'), findsOneWidget);
      expect(find.text('12 Main Road, Gaborone'), findsOneWidget);
      expect(find.text('Directions'), findsOneWidget);
      expect(find.text('PO-4471'), findsOneWidget);
      expect(find.textContaining('Please deliver only'), findsOneWidget);

      await tester.scrollUntilVisible(find.text('Grape Ice 800'), 200);
      expect(find.text('In this delivery'), findsOneWidget);
      expect(find.text('17 units · 2 products'), findsOneWidget);
      expect(find.text('Mango Ice 12000'), findsOneWidget);
      expect(find.text('1 shrink'), findsOneWidget);
      expect(find.text('7 units'), findsOneWidget);
      expect(find.text('Ordered 30 units'), findsOneWidget);
    });

    testWidgets('a lapsed PO is said plainly', (tester) async {
      final yesterday = DateTime.now().subtract(const Duration(days: 1));
      await _pumpDetail(
        tester,
        detail: _detail(_dispatch(poExpires: _isoDate(yesterday))),
      );
      expect(find.textContaining('PO expired on'), findsOneWidget);
    });

    testWidgets('Call when there is a number, with or without a name', (
      tester,
    ) async {
      await _pumpDetail(tester, detail: _detail());
      expect(find.textContaining('Call'), findsNothing);

      await _pumpDetail(
        tester,
        detail: _detail(_dispatch(phone: '+267 71 234 567')),
      );
      expect(find.text('Call'), findsOneWidget);

      await _pumpDetail(
        tester,
        detail: _detail(_dispatch(phone: '+267 71 234 567', contact: 'Neo')),
      );
      expect(find.text('Call Neo'), findsOneWidget);

      await _pumpDetail(
        tester,
        detail: _detail(_dispatch(phone: 'n/a', contact: 'Neo')),
      );
      expect(find.textContaining('Call'), findsNothing);
    });

    testWidgets('a finished delivery shows what arrived', (tester) async {
      await _pumpDetail(
        tester,
        detail: _detail(_dispatch(status: 'delivered'), [
          {..._lines.first, 'qty_delivered': 8, 'qty_returned': 2},
        ]),
      );
      await tester.scrollUntilVisible(
        find.text('8 delivered · 2 returned'),
        200,
      );
      expect(find.text('Received by'), findsOneWidget);
    });

    testWidgets('without its products, the rest is still shown', (
      tester,
    ) async {
      await _pumpDetail(
        tester,
        detail: DeliveryDetail.fromMaps(_dispatch(), null),
      );
      expect(find.text('12 Main Road, Gaborone'), findsOneWidget);
      expect(find.text('Directions'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.textContaining('products could not be loaded'),
        200,
      );
    });

    testWidgets('a delivery that is not theirs says so', (tester) async {
      await _pumpDetail(tester, detail: null);
      expect(find.text('This delivery is not yours any more'), findsOneWidget);
    });

    testWidgets('large text does not overflow a product row', (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2.0;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await _pumpDetail(tester, detail: _detail());
      await tester.scrollUntilVisible(find.text('Grape Ice 800'), 200);
      expect(tester.takeException(), isNull);
    });
  });

  group('when it goes wrong', () {
    testWidgets('a refusal is said at once, and not blamed on the signal', (
      tester,
    ) async {
      final repo = _FakeRepository(
        detail: () async =>
            throw const PostgrestException(message: 'nope', code: '42501'),
      );
      await tester.pumpWidget(
        _scope(
          repo,
          const MaterialApp(home: DeliveryDetailScreen(dispatchId: 'd1')),
        ),
      );
      // A frame or two, not the 38 seconds Riverpod's default retry takes.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('This delivery could not be opened'), findsOneWidget);
      expect(find.text('This needs a connection'), findsNothing);
      await tester.pump(const Duration(minutes: 1));
      expect(repo.detailCalls, 1);
    });

    testWidgets('no signal asks for a connection', (tester) async {
      await _pumpDetail(
        tester,
        fetch: () async => throw const SocketException('Failed host lookup'),
      );
      expect(find.text('This needs a connection'), findsOneWidget);
    });

    testWidgets('a pull that fails keeps the delivery on screen', (
      tester,
    ) async {
      var fail = false;
      await _pumpDetail(
        tester,
        fetch: () async {
          if (fail) throw const SocketException('Failed host lookup');
          return _detail();
        },
      );
      fail = true;
      await tester.fling(
        find.text('Main Road Superette'),
        const Offset(0, 400),
        1000,
      );
      await tester.pumpAndSettle();
      expect(find.text('Main Road Superette'), findsOneWidget);
      expect(find.textContaining('No connection'), findsOneWidget);
    });
  });

  group('from the list', () {
    Delivery listed(String status) => Delivery.fromMap({
      ..._dispatch(status: status),
      'lines': [
        {'qty': 10},
      ],
    });

    Future<(_FakeRepository, GoRouter)> pumpList(
      WidgetTester tester,
      _FakeRepository repo,
    ) async {
      final router = _router();
      await tester.pumpWidget(
        _scope(repo, MaterialApp.router(routerConfig: router)),
      );
      await tester.pumpAndSettle();
      return (repo, router);
    }

    testWidgets('a card opens its delivery, asked afresh each time', (
      tester,
    ) async {
      final (repo, router) = await pumpList(
        tester,
        _FakeRepository(list: [listed('in_transit')]),
      );

      await tester.tap(find.text('Main Road Superette'));
      await tester.pumpAndSettle();
      expect(find.text('Directions'), findsOneWidget);
      expect(repo.detailCalls, 1);

      router.pop();
      await tester.pumpAndSettle();
      expect(find.text('Directions'), findsNothing);
      await tester.tap(find.text('Main Road Superette'));
      await tester.pumpAndSettle();
      expect(repo.detailCalls, 2);
    });

    testWidgets('a delivery that has moved on refreshes the list behind it', (
      tester,
    ) async {
      final (repo, _) = await pumpList(
        tester,
        _FakeRepository(
          list: [listed('in_transit')],
          detail: () async => _detail(_dispatch(status: 'delivered')),
        ),
      );
      expect(repo.listCalls, 1);

      await tester.tap(find.text('Main Road Superette'));
      await tester.pumpAndSettle();
      expect(repo.listCalls, 2);
    });

    testWidgets('one that has not, leaves the list alone', (tester) async {
      final (repo, _) = await pumpList(
        tester,
        _FakeRepository(list: [listed('in_transit')]),
      );
      await tester.tap(find.text('Main Road Superette'));
      await tester.pumpAndSettle();
      expect(repo.listCalls, 1);
    });
  });

  group('recording the drop', () {
    testWidgets('a delivery on the road offers it', (tester) async {
      await _pumpDetail(tester, detail: _detail());
      expect(find.text('Record delivery'), findsOneWidget);
    });

    testWidgets('a finished one does not', (tester) async {
      await _pumpDetail(tester, detail: _detail(_dispatch(status: 'delivered')));
      expect(find.text('Record delivery'), findsNothing);
    });

    testWidgets('one recorded on this phone says it is waiting, and is not offered twice', (
      tester,
    ) async {
      await _pumpDetail(tester, detail: _detail(), pending: {'d1'});
      expect(find.text('Record delivery'), findsNothing);
      expect(
        find.text(
          'You recorded this as delivered. It will reach the warehouse when '
          'you have signal.',
        ),
        findsOneWidget,
        reason: 'no photo was taken, so none is promised',
      );
    });

    testWidgets('the photo is mentioned only when one is waiting with it', (tester) async {
      await _pumpDetail(tester, detail: _detail(), pending: {'d1'}, withPhoto: {'d1'});
      expect(
        find.text(
          'You recorded this as delivered. It will reach the warehouse, with '
          'the photo, when you have signal.',
        ),
        findsOneWidget,
      );
    });

    Future<void> recordDrop(WidgetTester tester, _FakeRepository repo) async {
      // Read already, as it is in the app by the time a drop is recorded.
      await tester.runAsync(
        () => ProviderScope.containerOf(
          tester.element(find.byType(DeliveryDetailScreen)),
        ).read(profileProvider.future),
      );
      await tester.tap(find.text('Record delivery'));
      await tester.pumpAndSettle();
      final pad = tester.getRect(find.byType(SignaturePad));
      await tester.dragFrom(pad.center - const Offset(80, 0), const Offset(160, 20));
      await tester.pump();
      await tester.runAsync(() async {
        await tester.tap(find.widgetWithText(FilledButton, 'Delivered'));
        // The signature renders off the test clock.
        for (var i = 0; i < 20 && repo.sendCalls == 0; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 50));
          await tester.pump();
        }
      });
      await tester.pumpAndSettle();
      expect(repo.confirmCalls, 1);
    }

    testWidgets('sent straight away, it says delivered, not "when you have signal"', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(400, 1000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repo = await _pumpDetail(tester, detail: _detail(_dispatch(contact: 'Thabo')));
      await recordDrop(tester, repo);
      expect(find.text('Delivered. The warehouse has it.'), findsOneWidget);
      expect(
        find.text('Delivery saved. It will reach the warehouse when you have signal.'),
        findsNothing,
      );
    });

    testWidgets('still on the phone, it says it goes when there is signal', (tester) async {
      await tester.binding.setSurfaceSize(const Size(400, 1000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repo = await _pumpDetail(
        tester,
        detail: _detail(_dispatch(contact: 'Thabo')),
        outcome: DropOutcome.waiting,
      );
      await recordDrop(tester, repo);
      expect(
        find.text('Delivery saved. It will reach the warehouse when you have signal.'),
        findsOneWidget,
      );
      expect(find.text('Delivered. The warehouse has it.'), findsNothing);
    });

    test('a drop the warehouse had already changed is not called delivered', () {
      expect(dropMessage(DropOutcome.notTaken), isNot(contains('Delivered')));
      expect(dropMessage(DropOutcome.notTaken), contains('not recorded'));
    });

    testWidgets('it needs a name and the receiver\'s signature; the photo is optional', (tester) async {
      await tester.binding.setSurfaceSize(const Size(400, 1000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await _pumpDetail(tester, detail: _detail(_dispatch(contact: 'Thabo')));
      await tester.tap(find.text('Record delivery'));
      await tester.pumpAndSettle();

      expect(find.text('Add a photo of the delivery note (optional)'), findsOneWidget);
      expect(find.byType(SignaturePad), findsOneWidget);
      // The order's contact is the likely receiver, so the name starts there.
      expect(find.widgetWithText(TextField, 'Thabo'), findsOneWidget);
      final delivered = find.widgetWithText(FilledButton, 'Delivered');
      expect(tester.widget<FilledButton>(delivered).onPressed, isNull,
          reason: 'not signed yet');
      expect(find.textContaining('everything on this delivery was taken'), findsOneWidget);

      // A signature, and no photo: enough.
      final pad = tester.getRect(find.byType(SignaturePad));
      await tester.dragFrom(pad.center - const Offset(80, 0), const Offset(160, 20));
      await tester.pumpAndSettle();
      expect(tester.widget<FilledButton>(delivered).onPressed, isNotNull,
          reason: 'signed, with a name');
    });
  });
}
