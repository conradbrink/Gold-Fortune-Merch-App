// Two pure decisions that would be expensive to get wrong in the field: which
// promotions apply here today, and which lines this visit has already answered.
//
// Both are worth a test because both fail silently. A date boundary that is two
// hours out shows a promotion a day early and hides it a day late, and nobody
// notices until a manager asks why a whole day is missing. An answered-set that
// is scoped to the promotion rather than the visit makes a month-long promotion
// answerable once, so every later visit reports nothing and looks like a rep
// who did not bother.

import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/data/models/promotion.dart';
import 'package:gf_merch_rep/data/repositories/promotion_repository.dart';

Promotion _promo({
  String id = 'promo-1',
  required String starts,
  required String ends,
  List<String> stores = const ['store-1'],
  List<PromotedProduct> products = const [
    PromotedProduct(id: 'prod-1', name: 'ZYN COOL MINT 3MG'),
    PromotedProduct(id: 'prod-2', name: 'ZYN SPEARMINT 3MG'),
  ],
}) {
  return Promotion(
    id: id,
    name: 'August push',
    startsOn: starts,
    endsOn: ends,
    storeIds: stores,
    products: products,
  );
}

void main() {
  group('localToday', () {
    test('reports the local date, not the UTC one', () {
      // 23:30 on the 5th in Botswana is already the 6th in UTC. Using the UTC
      // date here would start tomorrow's promotions half an hour before
      // midnight and end today's early.
      expect(localToday(DateTime(2026, 8, 5, 23, 30)), '2026-08-05');
      // And 01:00 is still the 6th locally, though UTC calls it the 5th.
      expect(localToday(DateTime(2026, 8, 6, 1, 0)), '2026-08-06');
    });

    test('pads months and days', () {
      expect(localToday(DateTime(2026, 1, 3)), '2026-01-03');
    });
  });

  group('coversDate', () {
    final p = _promo(starts: '2026-08-01', ends: '2026-08-31');

    test('includes both end points', () {
      // Inclusive on purpose: the schema check is `ends_on >= starts_on` and a
      // promotion that runs "to the 31st" runs on the 31st.
      expect(p.coversDate('2026-08-01'), isTrue);
      expect(p.coversDate('2026-08-31'), isTrue);
    });

    test('excludes the days either side', () {
      expect(p.coversDate('2026-07-31'), isFalse);
      expect(p.coversDate('2026-09-01'), isFalse);
    });

    test('compares as strings, so month boundaries do not wrap', () {
      final sept = _promo(starts: '2026-09-01', ends: '2026-09-30');
      expect(sept.coversDate('2026-10-01'), isFalse);
      expect(sept.coversDate('2026-08-31'), isFalse);
    });
  });

  group('forStore', () {
    test('keeps only promotions covering this outlet', () {
      final here = _promo(id: 'a', starts: '2026-08-01', ends: '2026-08-31');
      final elsewhere = _promo(
        id: 'b',
        starts: '2026-08-01',
        ends: '2026-08-31',
        stores: ['store-9'],
      );
      final got = PromotionRepository.forStore([here, elsewhere], 'store-1');
      expect(got.map((p) => p.id), ['a']);
    });
  });

  group('answers', () {
    test('an answer from an earlier visit does not count as answered now', () {
      // The case that matters: a month-long promotion, a weekly call cycle. An
      // answer given three weeks ago is context for the rep, not a job already
      // done — otherwise every visit after the first reports nothing.
      const lastVisit = PromotionAnswer(
        promotionId: 'promo-1',
        productId: 'prod-1',
        status: CheckStatus.running,
        thisVisit: false,
      );
      const thisVisit = PromotionAnswer(
        promotionId: 'promo-1',
        productId: 'prod-2',
        status: CheckStatus.notRunning,
        thisVisit: true,
      );

      final answers = {
        PromotionAnswer.key('promo-1', 'prod-1'): lastVisit,
        PromotionAnswer.key('promo-1', 'prod-2'): thisVisit,
      };

      final promo = _promo(starts: '2026-08-01', ends: '2026-08-31');
      final outstanding = promo.products
          .where((p) {
            final a = answers[PromotionAnswer.key(promo.id, p.id)];
            return a == null || !a.thisVisit;
          })
          .map((p) => p.id)
          .toList();

      expect(outstanding, ['prod-1']);
    });

    test('the key pairs a promotion with a line, not either alone', () {
      // The same product can be on two promotions at once; without both halves
      // answering it on one would silently answer it on the other.
      expect(PromotionAnswer.key('a', 'x'), isNot(PromotionAnswer.key('b', 'x')));
      expect(PromotionAnswer.key('a', 'x'), 'a:x');
    });
  });
}
