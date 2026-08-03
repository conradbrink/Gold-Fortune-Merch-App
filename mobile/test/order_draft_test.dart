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

  // ------------------------------------------------- shrinks vs base units
  //
  // The rep orders in shrinks; the warehouse reserves in base units. Getting
  // this wrong is silent in both directions — the order saves, the money looks
  // right, and the shop is short by a factor of the pack size — so the
  // arithmetic is pinned down here rather than left to be noticed on a
  // delivery.

  test('a line is sent in the base units the warehouse reserves in', () {
    // Three shrinks of a ten-pack is thirty units, at a tenth of the shrink
    // price. The line is worth the same either way round: 3 × 1595 = 4785,
    // and 30 × 159.50 = 4785.
    const line = OrderDraftLine(
      productId: 'elf-12000',
      qty: 3,
      unitsPerShrink: 10,
      unitPrice: 1595.00,
    );

    expect(line.qty, 3, reason: 'what the rep typed stays in shrinks');
    expect(line.qtyOrderedBaseUnits, 30);
    expect(line.unitPricePerBaseUnit, 159.50);
    expect(line.qtyOrderedBaseUnits * line.unitPricePerBaseUnit!, 4785.00);
  });

  test('a line with no price on record sends no price, not a zero', () {
    const line = OrderDraftLine(
      productId: 'black-cherry-11mg',
      qty: 2,
      unitsPerShrink: 5,
    );

    expect(line.qtyOrderedBaseUnits, 10);
    // Zero would read as given away free rather than as not yet priced.
    expect(line.unitPricePerBaseUnit, isNull);
  });

  test('a line with no pack size refuses rather than guessing at one', () {
    // Treating a missing factor as 1 would reserve a tenth of what the shop
    // asked for, and nothing downstream would question it.
    const line = OrderDraftLine(productId: 'p1', qty: 4, unitPrice: 100);

    expect(() => line.qtyOrderedBaseUnits, throwsStateError);
    expect(() => line.unitPricePerBaseUnit, throwsStateError);
  });

  test('a shrink price that does not divide evenly rounds to the cent', () {
    // `order_lines.unit_price` is numeric(12,2), so a price per unit cannot
    // carry a third decimal. 129.03 over five is 25.806, and the line is worth
    // two cents more than the price card as a result. Recorded so the
    // difference is a known rounding rather than a surprise on an invoice.
    const line = OrderDraftLine(
      productId: 'zyn',
      qty: 1,
      unitsPerShrink: 5,
      unitPrice: 129.03,
    );

    expect(line.unitPricePerBaseUnit, 25.81);
    // closeTo, not equals: five times 25.81 is 129.04999999999998 in binary
    // floating point. The database does the real arithmetic in numeric.
    expect(
      line.qtyOrderedBaseUnits * line.unitPricePerBaseUnit!,
      closeTo(129.05, 0.001),
    );
  });

  test('a restored draft comes back in shrinks, not converted units', () async {
    // The counter on the capture screen is fed straight from this. Storing the
    // converted figure would show a rep who ordered 3 shrinks a 30 they never
    // keyed, and a second save would convert it again.
    await OrderDraftStore(db).save(
      visitId,
      const OrderDraft(storeId: 'store-1', lines: [
        OrderDraftLine(
          productId: 'p1',
          qty: 3,
          unitsPerShrink: 10,
          unitPrice: 1595.00,
        ),
      ]),
    );

    final line = (await OrderDraftStore(db).load(visitId))!.lines.single;
    expect(line.qty, 3);
    expect(line.unitsPerShrink, 10);
    expect(line.unitPrice, 1595.00);
    expect(line.qtyOrderedBaseUnits, 30);
  });

  test('a draft written before the fix restores without a stale factor', () {
    // Older builds wrote no pack size. It must come back null so the capture
    // screen refills it from the live catalogue, rather than defaulting to
    // something that would quietly convert wrongly.
    final line = OrderDraftLine.fromMap({
      'product_id': 'p1',
      'qty': 6,
      'unit_price': 198.75,
    });

    expect(line.qty, 6);
    expect(line.unitsPerShrink, isNull);
    expect(() => line.qtyOrderedBaseUnits, throwsStateError);
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
