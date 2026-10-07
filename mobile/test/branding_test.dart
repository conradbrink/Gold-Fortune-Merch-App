import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/branding.dart';
import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/location_tracking.dart';
import 'package:gf_merch_rep/core/product.dart';
import 'package:gf_merch_rep/core/terms.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';

/// The company's words and look in its configuration (Stage 3): how the phone
/// reads them from `my_company_config()`, what it does when they are missing
/// or wrong, and how the logo is kept for offline use.
void main() {
  group('CompanyConfig.fromJson — terms and branding', () {
    test('reads both as the server sends them', () {
      final c = CompanyConfig.fromJson({
        'modules': {'core': true},
        'terms': {
          'site': {'one': 'Store', 'many': 'Stores', 'article': null},
          'job': {'one': 'Visit', 'many': 'Visits', 'article': null},
        },
        'branding': {
          'name': 'Gold Fortune',
          'legal_name': 'Gold Fortune (Pty) Ltd',
          'logo_path': 'org-1/logo.png',
          'primary': '#16224F',
          'accent': '#e0b84b',
        },
      });
      expect(c.terms.site.one, 'Store');
      expect(c.terms.job.many, 'Visits');
      expect(c.terms.staff, Terms.defaults.staff);
      expect(c.branding.name, 'Gold Fortune');
      expect(c.branding.legalName, 'Gold Fortune (Pty) Ltd');
      expect(c.branding.logoPath, 'org-1/logo.png');
      expect(c.branding.primary, const Color(0xFF16224F));
      expect(c.branding.accent, const Color(0xFFE0B84B), reason: 'any case');
    });

    test('a payload from before Stage 3 gets the neutral words and look', () {
      final c = CompanyConfig.fromJson({'modules': {'core': true}});
      expect(c.terms.site, Terms.defaults.site);
      expect(c.branding.name, isNull);
      expect(c.branding.logoPath, isNull);
      expect(c.branding.primary, kProductPrimary);
      expect(c.branding.accent, kProductAccent);
    });

    test('the fallback is neutral too', () {
      const f = CompanyConfig.fallback;
      expect(f.terms.site.one, 'Site');
      expect(f.branding.primary, kProductPrimary);
    });

    test('a bad colour keeps the product colour for that colour alone', () {
      final c = CompanyConfig.fromJson({
        'branding': {'primary': 'navy', 'accent': '#0EA5A4'},
      });
      expect(c.branding.primary, kProductPrimary);
      expect(c.branding.accent, const Color(0xFF0EA5A4));
    });

    test('blank text is no text', () {
      final b = Branding.fromJson({'name': '  ', 'logo_path': ''});
      expect(b.name, isNull);
      expect(b.logoPath, isNull);
    });

    test('branding that is not an object is the product look', () {
      for (final raw in [null, 'gold', 7, <Object>[]]) {
        final b = Branding.fromJson(raw);
        expect(b.primary, kProductPrimary);
        expect(b.name, isNull);
      }
    });
  });

  group('parseHexColor', () {
    test('accepts #RRGGBB only', () {
      expect(parseHexColor('#16224F'), const Color(0xFF16224F));
      expect(parseHexColor('#16224f'), const Color(0xFF16224F));
      for (final bad in [
        '16224F',
        '#16224',
        '#16224F00',
        '#FFF',
        '#GGGGGG',
        ' #16224F',
        null,
        0x16224F,
      ]) {
        expect(parseHexColor(bad), isNull, reason: '$bad');
      }
    });
  });

  group('brandingLogoUrl', () {
    test('is the public object URL in the branding bucket', () {
      expect(
        brandingLogoUrl('https://abc.supabase.co', 'org-1/logo.png').toString(),
        'https://abc.supabase.co/storage/v1/object/public/branding/org-1/logo.png',
      );
    });

    test('encodes each segment', () {
      expect(
        brandingLogoUrl('https://abc.supabase.co/', 'org 1/my logo.png')
            .toString(),
        'https://abc.supabase.co/storage/v1/object/public/branding/org%201/my%20logo.png',
      );
    });
  });

  group('trackingNotificationText', () {
    test('names the company that is recording', () {
      expect(
        trackingNotificationText('Gold Fortune'),
        'Gold Fortune is recording your location until you end the day.',
      );
    });

    test('falls back to the product while the company is unknown', () {
      expect(
        trackingNotificationText(null),
        '$kProductName is recording your location until you end the day.',
      );
      expect(trackingNotificationText(' '), startsWith(kProductName));
    });
  });

  group('LogoCache', () {
    late AppDatabase db;
    late Directory root;
    late HttpServer server;
    late String base;
    var requests = 0;
    var status = 200;

    setUp(() async {
      db = AppDatabase.forTesting(NativeDatabase.memory());
      root = await Directory.systemTemp.createTemp('logo_cache_test');
      requests = 0;
      status = 200;
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      base = 'http://${server.address.host}:${server.port}';
      server.listen((req) async {
        requests++;
        req.response.statusCode = status;
        if (status == 200) req.response.add([1, 2, 3, req.uri.path.length]);
        await req.response.close();
      });
    });

    tearDown(() async {
      await server.close(force: true);
      await db.close();
      await root.delete(recursive: true);
    });

    test('downloads once, then serves the copy on the phone', () async {
      final cache = LogoCache(db, root: root);
      final first = await cache.ensure(
          orgId: 'org-1', logoPath: 'org-1/logo.png', supabaseUrl: base);
      expect(first, isNotNull);
      expect(await first!.exists(), isTrue);
      expect(requests, 1);

      final again = await cache.ensure(
          orgId: 'org-1', logoPath: 'org-1/logo.png', supabaseUrl: base);
      expect(again!.path, first.path);
      expect(requests, 1, reason: 'the same path is not fetched twice');
    });

    test('a new logo path is fetched again, into a new file', () async {
      final cache = LogoCache(db, root: root);
      final old = await cache.ensure(
          orgId: 'org-1', logoPath: 'org-1/logo.png', supabaseUrl: base);
      final fresh = await cache.ensure(
          orgId: 'org-1', logoPath: 'org-1/logo-v2.png', supabaseUrl: base);
      expect(requests, 2);
      // A new name, or Flutter's image cache would go on showing the old one.
      expect(fresh!.path, isNot(old!.path));
      expect(await old.exists(), isFalse, reason: 'the replaced logo is gone');
    });

    test('no logo path is no logo, and no request', () async {
      final cache = LogoCache(db, root: root);
      expect(
        await cache.ensure(orgId: 'org-1', logoPath: null, supabaseUrl: base),
        isNull,
      );
      expect(requests, 0);
    });

    test('a failed download is no logo, and is tried again next time',
        () async {
      final cache = LogoCache(db, root: root);
      status = 404;
      expect(
        await cache.ensure(
            orgId: 'org-1', logoPath: 'org-1/logo.png', supabaseUrl: base),
        isNull,
      );
      status = 200;
      expect(
        await cache.ensure(
            orgId: 'org-1', logoPath: 'org-1/logo.png', supabaseUrl: base),
        isNotNull,
      );
      expect(requests, 2);
    });

    test('no network is no logo rather than an error', () async {
      final cache = LogoCache(db, root: root);
      await server.close(force: true);
      expect(
        await cache.ensure(
            orgId: 'org-1', logoPath: 'org-1/logo.png', supabaseUrl: base),
        isNull,
      );
    });
  });
}
