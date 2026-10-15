import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/data/models/store_reorder.dart';

StoreReorder _store({
  DateTime? last,
  int dueAfter = 30,
  int? usual,
  String? status = 'delivered',
  String? ref = 'SO-000150',
}) =>
    StoreReorder(
      storeId: 's1',
      lastOrderOn: last,
      lastOrderRef: last == null ? null : ref,
      lastOrderStatus: last == null ? null : status,
      usualDays: usual,
      dueAfterDays: dueAfter,
    );

void main() {
  final today = DateTime(2026, 10, 15, 9, 30);

  group('reorderStateOn', () {
    test('a store that never ordered', () {
      final s = reorderStateOn(_store(), today);
      expect(s.state, ReorderState.never);
      expect(s.daysSince, isNull);
      expect(s.asksForOrder, isTrue);
    });

    test('counts calendar days, whatever the time of day', () {
      final s = reorderStateOn(_store(last: DateTime(2026, 10, 14)), today);
      expect(s.daysSince, 1);
      expect(s.daysUntilDue, 29);
      expect(s.state, ReorderState.notDue);
      expect(s.asksForOrder, isFalse);
    });

    test('due soon from seven days before', () {
      expect(reorderStateOn(_store(last: DateTime(2026, 9, 23)), today).state,
          ReorderState.notDue); // 22 days, due in 8
      final s = reorderStateOn(_store(last: DateTime(2026, 9, 22)), today);
      expect(s.state, ReorderState.dueSoon); // 23 days, due in 7
      expect(s.daysUntilDue, 7);
      expect(s.asksForOrder, isFalse);
    });

    test('due on the day it reaches its due-after days', () {
      final s = reorderStateOn(_store(last: DateTime(2026, 9, 15)), today);
      expect(s.daysSince, 30);
      expect(s.state, ReorderState.due);
      expect(s.daysUntilDue, 0);
      expect(s.asksForOrder, isTrue);
    });

    test('stopped ordering at twice its due-after days, not before', () {
      expect(reorderStateOn(_store(last: DateTime(2026, 8, 17)), today).state,
          ReorderState.due); // 59 days
      expect(reorderStateOn(_store(last: DateTime(2026, 8, 16)), today).state,
          ReorderState.stopped); // 60 days
    });

    test("a store's own rhythm sets the clock", () {
      final s = reorderStateOn(
          _store(last: DateTime(2026, 10, 1), dueAfter: 14, usual: 14), today);
      expect(s.state, ReorderState.due);
      expect(reorderStateOn(
              _store(last: DateTime(2026, 9, 17), dueAfter: 14, usual: 14), today)
          .state, ReorderState.stopped);
    });
  });

  test('daysAgo', () {
    expect(daysAgo(0), 'today');
    expect(daysAgo(1), 'yesterday');
    expect(daysAgo(26), '26 days ago');
  });

  test('orderRhythm says it the way a person would', () {
    expect(orderRhythm(7), 'every 7 days');
    expect(orderRhythm(10), 'every 10 days');
    expect(orderRhythm(14), 'every 2 weeks');
    expect(orderRhythm(19), 'every 3 weeks');
    expect(orderRhythm(30), 'every 4 weeks');
    expect(orderRhythm(41), 'every 6 weeks');
    expect(orderRhythm(60), 'every 2 months');
    expect(orderRhythm(108), 'every 4 months');
  });

  test('lastOrderProgress only speaks while the order is on its way', () {
    expect(lastOrderProgress(_store(last: today, status: 'new')), 'not confirmed yet');
    expect(lastOrderProgress(_store(last: today, status: 'packed')), 'packed, not sent yet');
    expect(lastOrderProgress(_store(last: today, status: 'dispatched')), 'on its way');
    expect(lastOrderProgress(_store(last: today, status: 'delivered')), isNull);
    expect(lastOrderProgress(_store(last: today, status: 'invoiced')), isNull);
    expect(_store(last: today, status: 'packed').lastOrderOpen, isTrue);
    expect(_store(last: today, status: 'delivered').lastOrderOpen, isFalse);
    expect(_store(last: today, status: 'invoiced').isFromQuickBooks, isTrue);
  });

  test('a row survives the cache unchanged', () {
    final row = {
      'store_id': 's1',
      'store_name': 'Not kept',
      'last_order_on': '2026-09-19',
      'last_order_ref': '1790',
      'last_order_status': 'invoiced',
      'order_days_year': 5,
      'usual_days': 21,
      'due_after_days': 21,
      'due_on': '2026-10-10',
    };
    final r = StoreReorder.fromMap(row);
    expect(r.lastOrderOn, DateTime(2026, 9, 19));
    final back = StoreReorder.fromMap(r.toMap());
    expect(back.toMap(), r.toMap());
    expect(back.usualDays, 21);
    expect(back.dueAfterDays, 21);
    expect(back.isFromQuickBooks, isTrue);

    final never = StoreReorder.fromMap({
      'store_id': 's2',
      'last_order_on': null,
      'order_days_year': 0,
      'usual_days': null,
      'due_after_days': 30,
    });
    expect(never.lastOrderOn, isNull);
    expect(StoreReorder.fromMap(never.toMap()).toMap(), never.toMap());
    // A row from before 20261015200000, or a 1.2.1 cache: no lines.
    expect(never.lastLines, isEmpty);
    expect(never.lastLinesMissing, 0);
  });

  test("the last order's products survive the cache", () {
    final r = StoreReorder.fromMap({
      'store_id': 's1',
      'last_order_on': '2026-09-19',
      'due_after_days': 30,
      'last_lines': [
        {'product_id': 'p1', 'shrinks': 3},
        {'product_id': 'p2', 'shrinks': 1},
        {'product_id': null, 'shrinks': 2}, // not a line the phone can use
      ],
      'last_lines_missing': 2,
    });
    expect(r.lastLines.map((l) => '${l.productId}:${l.shrinks}'), ['p1:3', 'p2:1']);
    expect(r.lastLinesMissing, 2);
    final back = StoreReorder.fromMap(r.toMap());
    expect(back.lastLines.map((l) => '${l.productId}:${l.shrinks}'), ['p1:3', 'p2:1']);
    expect(back.lastLinesMissing, 2);
  });

  test('every reason the database accepts has words, and only those', () {
    expect(declineReasons.keys.toSet(),
        {'has_stock', 'buyer_away', 'no_money', 'price', 'other_supplier', 'other'});
  });
}
