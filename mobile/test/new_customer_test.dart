// A rep adds a customer on the phone (`store_add_from_phone()`), then visits
// and orders there, possibly with no signal. The customer must reach the
// server before anything that names it, and must stay in the picker until the
// server has it. A name already on the list is offered, not refused: see
// same_name_customer_test.dart.
//
// A real `SupabaseClient` over a fake PostgREST, as in order_replay_test.dart.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/addresses.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/order_draft.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/store_group.dart';
import 'package:gf_merch_rep/data/models/store_summary.dart';
import 'package:gf_merch_rep/data/repositories/route_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:gf_merch_rep/features/orders/order_capture_screen.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _json = {'content-type': 'application/json'};

http.Response _answer(http.Request request, Object body, int status) =>
    http.Response(jsonEncode(body), status, headers: _json, request: request);

StoreSummary _store(String id, String name, {String? city}) =>
    StoreSummary(id: id, name: name, city: city, geofenceRadiusM: 100);

void main() {
  late AppDatabase db;
  SupabaseClient? client;
  late List<http.Request> requests;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    requests = [];
  });

  tearDown(() async {
    await client?.dispose();
    client = null;
    await db.close();
  });

  /// Replaces the fake server; the one before it is closed.
  Future<SupabaseClient> clientAnswering(
    http.Response Function(http.Request request) answer,
  ) async {
    await client?.dispose();
    return client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        requests.add(request);
        return answer(request);
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
  }

  SyncEngine engine() =>
      SyncEngine(db, client!, readBuild: () async => null, signedInUser: () => 'rep-1');

  Future<RouteRepository> addedOffline() async {
    final repo = RouteRepository(
      await clientAnswering((r) => http.Response('offline', 503, request: r)),
      db,
    );
    await repo.addStoreFromPhone(
      storeId: 'store-new',
      repId: 'rep-1',
      name: '  Kgale   View  Filling ',
      address: ' 12 Main Road ',
      city: ' Mahikeng ',
      lat: -25.85,
      lng: 25.64,
      accuracyM: 9,
      storeGroupId: 'group-1',
      contact: const StoreContact(name: 'K. Molefe', phone: '0820000000'),
    );
    return repo;
  }

  Future<void> queueDecline(String storeId) => db.enqueue(
        entityType: OutboxType.orderDecline,
        clientGeneratedId: 'decline-$storeId',
        payload: jsonEncode({
          'org_id': 'org-1',
          'rep_id': 'rep-1',
          'store_id': storeId,
          'visit_client_generated_id': 'visit-1',
          'client_generated_id': 'decline-$storeId',
          'reason': 'has_stock',
        }),
      );

  test('the customer is queued tidied, with the contact remembered', () async {
    final repo = await addedOffline();

    final entry = (await db.pendingEntries()).single;
    expect(entry.entityType, OutboxType.storeAdd);
    expect(entry.clientGeneratedId, 'store-new');
    final payload = jsonDecode(entry.payload) as Map<String, dynamic>;
    expect(payload['name'], 'Kgale View Filling');
    expect(payload['address'], '12 Main Road');
    expect(payload['city'], 'Mahikeng');
    expect(payload['store_group_id'], 'group-1');
    expect(payload['rep_id'], 'rep-1');

    final contact = await repo.contactFor('store-new');
    expect(contact?.name, 'K. Molefe');
    expect(contact?.phone, '0820000000');
  });

  test('offline, the picker lists the customer added on this phone', () async {
    final repo = await addedOffline();
    final stores = await repo.fetchStores();
    expect(stores.map((s) => s.id), contains('store-new'));
    expect(storesNamed(stores, 'KGALE VIEW filling'), hasLength(1));
  });

  test('once the server lists the customer, its copy replaces the phone\'s', () async {
    await addedOffline();
    final repo = RouteRepository(
      // The list ends after this one (`id=gt.` the last id it sent).
      await clientAnswering((r) => _answer(
          r,
          r.url.queryParameters.containsKey('id')
              ? []
              : [
                  {'id': 'store-new', 'name': 'Kgale View Filling', 'geofence_radius_m': 80},
                ],
          200)),
      db,
    );

    final stores = await repo.fetchStores();
    expect(stores, hasLength(1));
    expect(stores.single.geofenceRadiusM, 80);
    expect(jsonDecode((await db.getValue('stores_added'))!), isEmpty);
  });

  test('replay calls store_add_from_phone with what the rep typed', () async {
    await addedOffline();
    await clientAnswering((r) => _answer(r, {'store_id': 'store-new', 'already_added': false}, 200));

    await engine().sync();

    expect(await db.pendingEntries(maxAttempts: kMaxAttempts), isEmpty);
    final call = requests.single;
    expect(call.url.path, endsWith('/rpc/store_add_from_phone'));
    final body = jsonDecode(call.body) as Map<String, dynamic>;
    expect(body['p_store_id'], 'store-new');
    expect(body['p_name'], 'Kgale View Filling');
    expect(body['p_address'], '12 Main Road');
    expect(body['p_lat'], -25.85);
    expect(body['p_store_group_id'], 'group-1');
  });

  test('work for a customer that has not landed waits; work for others goes', () async {
    await addedOffline();
    await queueDecline('store-new');
    await queueDecline('store-old');
    // The customer has given up: it must hold back what names it, and only that.
    final add = (await db.pendingEntries()).first;
    await db.recordFailure(add.id, kMaxAttempts, 'refused');

    await clientAnswering((r) => r.url.path.endsWith('/order_declines')
        ? _answer(r, [], 201)
        : http.Response('unexpected ${r.url.path}', 500, request: r));
    await engine().sync();

    final sent = requests.map((r) => jsonDecode(r.body)).map((b) => b is List ? b.single : b);
    expect(sent.map((b) => b['store_id']), ['store-old']);
    final left = await db.pendingEntries();
    expect(left.map((e) => e.clientGeneratedId), ['store-new', 'decline-store-new']);
  });

  test('a store_add entry and a store the phone did not add depend on nothing', () {
    OutboxEntry entry(String type, Map<String, dynamic> payload) => OutboxEntry(
          id: 1,
          entityType: type,
          payload: jsonEncode(payload),
          clientGeneratedId: 'x',
          createdAt: DateTime(2026),
          attempts: 0,
        );
    expect(dependencyKeyOf(entry(OutboxType.storeAdd, {'store_id': 's'})), isNull);
    expect(dependencyKeyOf(entry(OutboxType.orderCreate, {'store_id': 's'})),
        outboxEntryKey(OutboxType.storeAdd, 's'));
    expect(dependencyKeyOf(entry(OutboxType.visitCheckIn, {'store_id': 's'})),
        outboxEntryKey(OutboxType.storeAdd, 's'));
    expect(dependencyKeyOf(entry(OutboxType.workdayStart, {'org_id': 'o'})), isNull);
  });

  test('a name is the same name in any case and spacing', () {
    final stores = [_store('a', 'Sunrise Superette', city: 'Maun'), _store('b', 'Sunset')];
    expect(storesNamed(stores, '  sunrise   SUPERETTE ').map((s) => s.id), ['a']);
    expect(storesNamed(stores, 'Sunrise'), isEmpty);
    expect(storesNamed(stores, '   '), isEmpty);
  });

  test('a draft keeps the delivery address, and an old draft reads without one', () {
    const draft = OrderDraft(
      storeId: 's',
      lines: [],
      contactName: 'K. Molefe',
      deliveryAddress: '12 Main Road, Mahikeng',
    );
    expect(OrderDraft.decode(draft.encode())?.deliveryAddress, '12 Main Road, Mahikeng');

    final old = jsonEncode({'store_id': 's', 'lines': [], 'saved_at': DateTime.now().toIso8601String()});
    expect(OrderDraft.decode(old)?.deliveryAddress, isNull);
  });
  test('an order is not saved without where it goes and who to ask for', () {
    expect(
      missingDeliveryDetails(address: '12 Main Road', contactName: 'K. Molefe', contactPhone: '082'),
      isNull,
    );
    expect(
      missingDeliveryDetails(address: '12 Main Road', contactName: 'K. Molefe', contactPhone: '  '),
      'Fill in their phone number before saving.',
    );
    expect(
      missingDeliveryDetails(address: '', contactName: '', contactPhone: ''),
      'Fill in the delivery address, who placed it and their phone number before saving.',
    );
  });

  test('the delivery address starts as the street and the town, once', () {
    expect(deliveryAddressOf('12 Main Road', 'Mahikeng'), '12 Main Road, Mahikeng');
    expect(deliveryAddressOf('12 Main Road, Mahikeng', 'mahikeng'), '12 Main Road, Mahikeng');
    expect(deliveryAddressOf(null, 'Mahikeng'), 'Mahikeng');
    expect(deliveryAddressOf('  ', null), isNull);
  });

  test('a remembered contact that does not read back is skipped, not thrown', () async {
    final repo = RouteRepository(
      await clientAnswering((r) => http.Response('offline', 503, request: r)),
      db,
    );
    await db.setValue('store_contacts', '[not a map');
    expect(await repo.contactFor('store-1'), isNull);
    await repo.rememberContact('store-1', const StoreContact(name: 'K', phone: '082'));
    expect((await repo.contactFor('store-1'))?.phone, '082');
  });
}
