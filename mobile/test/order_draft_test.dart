// An order is the worst thing in this app to lose.
//
// A form can be filled in again from the shelf. An order cannot: the shopkeeper
// has read out twenty lines and will not do it again patiently, and the rep is
// standing in front of them. Android kills this app whenever something else
// wants the memory, so "held in State" is not a place an order can live.
//
// These tests do not simulate the kill with a method that hints at it. The
// store is thrown away and a new one built against the same database, which is
// what the rep actually gets after Android restarts the app.

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/order_draft.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });

  tearDown(() async => db.close());

  const visitId = 'visit-client-1';

  test('an order survives the app being killed mid-capture', () async {
    await OrderDraftStore(db).save(
      visitId,
      const OrderDraft(
        storeId: 'store-1',
        note: 'Deliver before Friday',
        lines: [
          OrderDraftLine(productId: 'p1', qty: 12, unitPrice: 45.5),
          OrderDraftLine(productId: 'p2', qty: 3),
        ],
      ),
    );

    // The process dies here. A completely new store against the same database
    // is what comes back.
    final recovered = await OrderDraftStore(db).load(visitId);

    expect(recovered, isNotNull);
    expect(recovered!.storeId, 'store-1');
    expect(recovered.note, 'Deliver before Friday');
    expect(recovered.lines.length, 2);
    expect(recovered.lines.first.productId, 'p1');
    expect(recovered.lines.first.qty, 12);
    expect(recovered.lines.first.unitPrice, 45.5);
    // A line with no price is legitimate — a product with no trade price on
    // record — and must not come back as zero, which would read as free.
    expect(recovered.lines[1].unitPrice, isNull);
  });

  test('two visits to the same shop in one day do not share a draft', () async {
    final store = OrderDraftStore(db);
    await store.save(
      'visit-morning',
      const OrderDraft(storeId: 'store-1', lines: [
        OrderDraftLine(productId: 'p1', qty: 5),
      ]),
    );

    // The afternoon call is a different order at the same shop. Keying the
    // draft on the store rather than the visit would resurrect the morning's
    // lines into it.
    expect(await store.load('visit-afternoon'), isNull);
    expect((await store.load('visit-morning'))!.lines.single.qty, 5);
  });

  test('a draft older than a week is not offered', () async {
    // Written directly, because the store always stamps `now`. Eight days is a
    // phone that was never opened again, not an order anybody is waiting on.
    final stale = OrderDraft(
      storeId: 'store-1',
      savedAt: DateTime.now().subtract(const Duration(days: 8)),
      lines: const [OrderDraftLine(productId: 'p1', qty: 1)],
    );
    await db.setValue(OrderDraft.keyFor(visitId), stale.encode());

    expect(await OrderDraftStore(db).load(visitId), isNull);
    // And it is cleared rather than left to be re-read on every open.
    expect(await db.getValue(OrderDraft.keyFor(visitId)), isNull);
  });

  test('a draft saved six days ago is still offered', () async {
    final recent = OrderDraft(
      storeId: 'store-1',
      savedAt: DateTime.now().subtract(const Duration(days: 6)),
      lines: const [OrderDraftLine(productId: 'p1', qty: 7)],
    );
    await db.setValue(OrderDraft.keyFor(visitId), recent.encode());

    final loaded = await OrderDraftStore(db).load(visitId);
    expect(loaded, isNotNull);
    expect(loaded!.lines.single.qty, 7);
  });

  test('a corrupt draft is dropped rather than crashing the screen', () async {
    await db.setValue(OrderDraft.keyFor(visitId), '{not json at all');

    // The rep gets an empty order form, not a crash on the one screen they
    // cannot do their job without.
    expect(await OrderDraftStore(db).load(visitId), isNull);
    expect(await db.getValue(OrderDraft.keyFor(visitId)), isNull);
  });

  test('submitting clears the draft so it cannot be sent twice', () async {
    final store = OrderDraftStore(db);
    await store.save(
      visitId,
      const OrderDraft(storeId: 'store-1', lines: [
        OrderDraftLine(productId: 'p1', qty: 2),
      ]),
    );
    await store.clear(visitId);
    expect(await store.load(visitId), isNull);
  });
}
