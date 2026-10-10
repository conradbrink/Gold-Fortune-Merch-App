import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/terms.dart';

/// The company's words (Stage 3). The phone's helper mirrors the web's
/// `lib/terms.ts`, so these pin the same behaviour: a sentence built from a
/// term reads the same on the dashboard and in the field.
void main() {
  // Gold Fortune's words, as its configuration sends them.
  final gf = Terms.fromJson({
    'site': {'one': 'Store', 'many': 'Stores', 'article': null},
    'site_group': {'one': 'Chain', 'many': 'Chains'},
    'job': {'one': 'Visit', 'many': 'Visits'},
    'staff': {'one': 'Rep', 'many': 'Reps'},
    'client': {'one': 'Customer', 'many': 'Customers'},
    'territory': {'one': 'Territory', 'many': 'Territories'},
    'schedule_cycle': {'one': 'Call cycle', 'many': 'Call cycles'},
    'day_plan': {'one': "Today's route", 'many': "Today's routes"},
  });

  group('Terms.fromJson', () {
    test('reads the company\'s words', () {
      expect(gf.site.one, 'Store');
      expect(gf.site.many, 'Stores');
      expect(gf.siteGroup.one, 'Chain');
      expect(gf.staff.many, 'Reps');
      expect(gf.territory.many, 'Territories');
      expect(gf.dayPlan.one, "Today's route");
    });

    test('a key the company has not set keeps the neutral default', () {
      expect(gf.region, Terms.defaults.region);
      expect(gf.workday.one, 'Workday');
      expect(gf.prospect.one, 'Lead');
    });

    test('the defaults are the catalogue\'s neutral words', () {
      const d = Terms.defaults;
      expect(d.site.one, 'Site');
      expect(d.siteGroup.one, 'Group');
      expect(d.job.one, 'Job');
      expect(d.staff.one, 'Staff member');
      expect(d.staff.many, 'Staff');
      expect(d.client.one, 'Client');
      expect(d.territory.one, 'Territory');
      expect(d.scheduleCycle.one, 'Recurring schedule');
      expect(d.dayPlan.one, "Today's jobs");
    });

    test('a blank, missing or malformed word keeps the default for that word',
        () {
      final t = Terms.fromJson({
        'site': {'one': '  ', 'many': 42},
        'job': 'Visit',
        'staff': {'one': ' Cleaner ', 'many': 'Cleaners'},
      });
      expect(t.site, Terms.defaults.site);
      expect(t.job, Terms.defaults.job);
      expect(t.staff.one, 'Cleaner', reason: 'trimmed');
    });

    test('anything that is not an object is all defaults', () {
      for (final raw in [null, 'terms', 3, <Object>[]]) {
        final t = Terms.fromJson(raw);
        expect(t.site, Terms.defaults.site);
        expect(t.dayPlan, Terms.defaults.dayPlan);
      }
    });

    test('only "a" and "an" are accepted as an article', () {
      final t = Terms.fromJson({
        'site': {'one': 'Hotel', 'many': 'Hotels', 'article': 'an'},
        'job': {'one': 'Unit', 'many': 'Units', 'article': 'the'},
      });
      expect(t.site.article, 'an');
      expect(t.job.article, isNull);
    });
  });

  group('one and many', () {
    test('count picks the form and lower-cases it for running text', () {
      expect(gf.site.count(0), '0 stores');
      expect(gf.site.count(1), '1 store');
      expect(gf.site.count(3), '3 stores');
      expect(Terms.defaults.staff.count(2), '2 staff');
    });

    test('count keeps the capital when asked for a label', () {
      expect(gf.site.count(3, label: true), '3 Stores');
      expect(gf.site.count(1, label: true), '1 Store');
    });
  });

  group('withArticle', () {
    test('decides a or an from the first letter', () {
      expect(gf.site.withArticle, 'a store');
      expect(Terms.fromJson({
        'site': {'one': 'Outlet', 'many': 'Outlets'},
      }).site.withArticle, 'an outlet');
    });

    test('the company\'s article wins over the first letter', () {
      final t = Terms.fromJson({
        'site': {'one': 'Hotel', 'many': 'Hotels', 'article': 'an'},
        'job': {'one': 'Unit check', 'many': 'Unit checks', 'article': 'a'},
      });
      expect(t.site.withArticle, 'an hotel');
      expect(t.job.withArticle, 'a unit check');
    });
  });

  group('lower, capital, title, possessive', () {
    test('lower leaves acronyms alone', () {
      expect(lower('Store'), 'store');
      expect(lower('POS outlet'), 'POS outlet');
      expect(lower('ATM'), 'ATM');
      expect(lower("Today's route"), "today's route");
      expect(gf.staff.manyLower, 'reps');
      expect(gf.site.oneLower, 'store');
    });

    test('capital opens a sentence', () {
      expect(capital(gf.site.withArticle), 'A store');
      expect(capital(''), '');
    });

    test('title capitalises every word', () {
      expect(title("Today's route"), "Today's Route");
      expect(title('Call cycle'), 'Call Cycle');
    });

    test('possessive', () {
      expect(possessive('Store'), "Store's");
      expect(possessive('Reps'), "Reps'");
      expect(possessive(gf.site.withArticle), "a store's");
    });
  });
}
