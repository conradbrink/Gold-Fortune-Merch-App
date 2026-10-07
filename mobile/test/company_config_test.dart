import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/location_tracking.dart';
import 'package:gf_merch_rep/features/workday/workday_auto_end.dart';

/// The phone's half of company settings and modules (Stage 2). The values
/// arrive from `my_company_config()`; these pin how the phone reads them, what
/// it does when they are missing, and the rules derived from them.
void main() {
  group('CompanyConfig.fromJson', () {
    test('reads modules and settings as the server sends them', () {
      final c = CompanyConfig.fromJson({
        'org_id': 'x',
        'modules': {
          'core': true,
          'hr': false,
          'distribution': true,
          'warehouse': false,
        },
        'settings': {
          'gps_ping_interval_minutes': 20,
          'short_visit_minutes': 15,
          'auto_end_enabled': false,
          'auto_end_time': '18:00',
          'checkin_radius_m': 150,
        },
      });
      expect(c.has('core'), isTrue);
      expect(c.has('distribution'), isTrue);
      expect(c.has('hr'), isFalse);
      expect(c.has('warehouse'), isFalse);
      expect(c.pingInterval, const Duration(minutes: 20));
      expect(c.shortVisit, const Duration(minutes: 15));
      expect(c.autoEnd.enabled, isFalse);
      expect(c.autoEnd.label, '18:00');
      expect(c.checkinRadiusM, 150);
    });

    test('Gold Fortune\'s values are the fallback, so its phones do not change', () {
      const f = CompanyConfig.fallback;
      expect(f.pingInterval, kLocationPingInterval);
      expect(f.shortVisit, const Duration(minutes: 5));
      expect(f.autoEnd, AutoEndRule.fallback);
      expect(f.autoEnd.label, '19:30');
      expect(f.checkinRadiusM, 100);
    });

    test('a missing or malformed setting keeps the fallback for that field only', () {
      final c = CompanyConfig.fromJson({
        'modules': {'hr': true},
        'settings': {
          'gps_ping_interval_minutes': 'often',
          'auto_end_time': '25:00',
          'short_visit_minutes': 0,
        },
      });
      expect(c.pingInterval, kLocationPingInterval);
      expect(c.autoEnd.label, '19:30');
      expect(c.shortVisit, Duration.zero, reason: '0 is valid: the check is off');
      expect(c.has('hr'), isTrue);
      expect(c.has('distribution'), isFalse);
    });

    test('core is always on, even when the server omits it', () {
      expect(CompanyConfig.fromJson({'modules': {}}).has('core'), isTrue);
    });
  });

  group('rules derived from the GPS interval', () {
    test('at 5 minutes they are the old constants', () {
      const f = CompanyConfig.fallback;
      expect(f.minPingSpacing, kMinPingSpacing);
      expect(f.trailStallAfter, kTrailStallAfter);
    });

    test('they scale with a longer interval', () {
      final c = CompanyConfig.fromJson({
        'settings': {'gps_ping_interval_minutes': 20},
      });
      expect(c.minPingSpacing, const Duration(minutes: 16));
      expect(c.trailStallAfter, const Duration(minutes: 40));
      final now = DateTime(2026, 10, 7, 12);
      expect(
        shouldRecordPing(
          now: now,
          lastPingAt: now.subtract(const Duration(minutes: 10)),
          minSpacing: c.minPingSpacing,
        ),
        isFalse,
      );
      expect(
        trailLooksStalled(
          now: now,
          startedAt: now.subtract(const Duration(minutes: 30)),
          stallAfter: c.trailStallAfter,
        ),
        isFalse,
      );
    });
  });

  group('auto-end rule', () {
    final start = DateTime(2026, 10, 7, 8);

    test('a company time replaces 19:30', () {
      const rule = AutoEndRule(enabled: true, hour: 18, minute: 0);
      expect(autoEndCutoffFor(start, rule: rule), DateTime(2026, 10, 7, 18));
      expect(
        isPastAutoEnd(now: DateTime(2026, 10, 7, 18, 1), startedAt: start, rule: rule),
        isTrue,
      );
    });

    test('switched off, a day is never past its end', () {
      const off = AutoEndRule(enabled: false, hour: 19, minute: 30);
      expect(
        isPastAutoEnd(now: DateTime(2026, 10, 8, 3), startedAt: start, rule: off),
        isFalse,
      );
    });

    test('parseTime accepts HH:MM and nothing else', () {
      expect(AutoEndRule.parseTime('07:05'), (7, 5));
      expect(AutoEndRule.parseTime('7:05'), isNull);
      expect(AutoEndRule.parseTime('24:00'), isNull);
      expect(AutoEndRule.parseTime(1930), isNull);
    });
  });

  group('moduleForLocation', () {
    test('each gated screen belongs to its module', () {
      expect(moduleForLocation('/my-hr'), 'hr');
      expect(moduleForLocation('/my-hr/leave'), 'hr');
      expect(moduleForLocation('/deliveries'), 'warehouse');
      expect(moduleForLocation('/unscheduled/sales'), 'distribution');
      expect(moduleForLocation('/unscheduled/sales/abc'), 'distribution');
      expect(moduleForLocation('/visit/123/order'), 'distribution');
    });

    test('everything else is core', () {
      expect(moduleForLocation('/'), 'core');
      expect(moduleForLocation('/unscheduled'), 'core');
      expect(moduleForLocation('/unscheduled/store'), 'core');
      expect(moduleForLocation('/visit/123'), 'core');
      expect(moduleForLocation('/files'), 'core');
      expect(moduleForLocation('/my-hrx'), 'core');
    });
  });
}
