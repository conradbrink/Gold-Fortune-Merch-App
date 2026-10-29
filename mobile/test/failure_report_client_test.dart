// The phone reports to Sentry the Supabase failures that mean something is
// broken, even when a screen catches them, and not the refusals that are the
// app working. The rules match web/lib/supabase/fetch.ts.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/failure_report_client.dart';
import 'package:gf_merch_rep/core/skew_retry_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _api = 'https://x.supabase.co';
const _json = {'content-type': 'application/json', 'sb-request-id': 'r1'};
const _fromSupabase = {'sb-request-id': 'r1'};

Uri _url(String path) => Uri.parse('$_api$path');

SupabaseFailure? _failureOf(String path, int status, Object? body) =>
    FailureReportClient.failureOf(_url(path), 'POST', status, body);

void main() {
  test('what counts as broken', () {
    final broken = <(String, int, Object?)>[
      (
        '/rest/v1/rpc/visit_check_in',
        500,
        {'code': 'XX000', 'message': 'internal'},
      ),
      (
        '/rest/v1/rpc/visit_check_in',
        404,
        {'code': 'PGRST202', 'message': 'Could not find the function'},
      ),
      (
        '/rest/v1/visits',
        400,
        {'code': 'PGRST204', 'message': "Could not find the 'x' column"},
      ),
      (
        '/rest/v1/order_lines',
        403,
        {
          'code': '42501',
          'message':
              'new row violates row-level security policy for table "order_lines"',
        },
      ),
      (
        '/rest/v1/stores',
        409,
        {'code': '23503', 'message': 'violates foreign key constraint'},
      ),
      (
        '/rest/v1/stores',
        400,
        {'code': '23502', 'message': 'null value in column "name"'},
      ),
      (
        '/rest/v1/stores',
        400,
        {'code': '22P02', 'message': 'invalid input syntax for type uuid'},
      ),
      (
        '/rest/v1/rpc/f',
        400,
        {'code': '42883', 'message': 'function does not exist'},
      ),
      (
        '/rest/v1/rpc/f',
        500,
        {
          'code': '57014',
          'message': 'canceling statement due to statement timeout',
        },
      ),
      (
        '/storage/v1/object/visit-photos/org/a.jpg',
        400,
        {
          'statusCode': '403',
          'error': 'Unauthorized',
          'message': 'new row violates row-level security policy',
        },
      ),
      ('/storage/v1/object/visit-photos/org/a.jpg', 502, null),
      (
        '/auth/v1/token',
        500,
        {'code': 'unexpected_failure', 'message': 'Database error'},
      ),
      ('/functions/v1/send-email', 503, null),
    ];
    for (final (path, status, body) in broken) {
      expect(
        _failureOf(path, status, body),
        isNotNull,
        reason: '$path $status should be reported',
      );
    }
  });

  test(
    'the app working is not reported: its own refusals, sign-in mistakes, no row, the signed-out',
    () {
      final fine = <(String, int, Object?)>[
        (
          '/rest/v1/rpc/store_add_from_phone',
          400,
          {'code': '22023', 'message': 'Choose a price group.'},
        ),
        (
          '/rest/v1/rpc/store_add_from_phone',
          403,
          {'code': '42501', 'message': 'That customer cannot be added.'},
        ),
        (
          '/rest/v1/order_lines',
          409,
          {
            'code': '23505',
            'message': 'duplicate key value violates unique constraint',
          },
        ),
        (
          '/rest/v1/vehicle_logbook',
          400,
          {
            'code': '23514',
            'message': 'violates check constraint odometer_order',
          },
        ),
        (
          '/rest/v1/rpc/get_visit',
          400,
          {'code': 'P0002', 'message': 'That visit was not found.'},
        ),
        (
          '/rest/v1/profiles',
          406,
          {
            'code': 'PGRST116',
            'message': 'Cannot coerce the result to a single JSON object',
          },
        ),
        (
          '/rest/v1/rpc/workday_close',
          500,
          {
            'code': '40001',
            'message': 'That workday was closed by someone else a moment ago.',
          },
        ),
        (
          '/rest/v1/rpc/store_set_location',
          500,
          {'code': '55000', 'message': 'This store already has a location.'},
        ),
        (
          '/rest/v1/rpc/f',
          500,
          {'code': '54000', 'message': 'Too many changes in the last hour.'},
        ),
        (
          '/rest/v1/profiles',
          401,
          {'code': 'PGRST301', 'message': 'JWT expired'},
        ),
        (
          '/auth/v1/token',
          400,
          {
            'code': 'invalid_credentials',
            'message': 'Invalid login credentials',
          },
        ),
        (
          '/auth/v1/token',
          400,
          {
            'code': 'refresh_token_not_found',
            'message': 'Invalid Refresh Token',
          },
        ),
        (
          '/storage/v1/object/visit-photos/a.jpg',
          400,
          {
            'statusCode': '404',
            'error': 'not_found',
            'message': 'Object not found',
          },
        ),
        ('/functions/v1/send-email', 400, {'error': 'Missing recipient'}),
        ('/rest/v1/visits', 201, null),
      ];
      for (final (path, status, body) in fine) {
        expect(
          _failureOf(path, status, body),
          isNull,
          reason: '$path $status should not be reported',
        );
      }
    },
  );

  test(
    "a file's path, a request's ids and a typed value never reach the report",
    () {
      expect(
        _failureOf(
          '/storage/v1/object/visit-photos/org-1/Choppies%20shelf.jpg',
          500,
          null,
        )?.resource,
        'object/visit-photos',
      );
      expect(
        _failureOf(
          '/storage/v1/object/sign/visit-photos/a.jpg',
          500,
          null,
        )?.resource,
        'object/visit-photos',
      );
      expect(
        _failureOf(
          '/storage/v1/object/upload/sign/visit-photos/a.jpg',
          500,
          null,
        )?.resource,
        'object/visit-photos',
      );
      expect(
        _failureOf(
          '/rest/v1/rpc/delivery_confirm?p_id=5b1e',
          500,
          null,
        )?.resource,
        'rpc/delivery_confirm',
      );
      expect(
        _failureOf('/rest/v1/orders?id=eq.5b1e', 500, null)?.resource,
        'orders',
      );
      final typed = _failureOf('/rest/v1/stores', 400, {
        'code': '22P02',
        'message': 'invalid input syntax for type uuid: "Choppies"',
      });
      expect(typed?.message, 'invalid input syntax for type uuid');
    },
  );

  // The tap breadcrumbs come from SentryWidget at the app's root. A build with
  // no DSN never starts Sentry, and the app must still draw and take taps.
  testWidgets(
    'the app draws and takes taps under SentryWidget without Sentry',
    (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        SentryWidget(
          child: MaterialApp(
            home: Scaffold(
              body: ElevatedButton(
                onPressed: () => taps++,
                child: const Text('Save order'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Save order'));
      await tester.pump();
      expect(taps, 1);
    },
  );

  group('the client', () {
    late List<SupabaseFailure> reports;
    setUp(() => reports = []);

    FailureReportClient over(MockClient inner, {DateTime Function()? now}) =>
        FailureReportClient(inner: inner, report: reports.add, now: now);

    test(
      'reports a broken request, and the caller still reads the answer',
      () async {
        final client = over(
          MockClient(
            (request) async => http.Response(
              jsonEncode({
                'code': '42703',
                'message': 'column visits.foo does not exist',
                'details': 'Choppies',
              }),
              400,
              headers: _json,
              request: request,
            ),
          ),
        );
        final response = await client.patch(
          _url('/rest/v1/visits?id=eq.1'),
          body: '{"notes":"Choppies"}',
        );
        expect(response.statusCode, 400);
        expect(jsonDecode(response.body)['code'], '42703');
        expect(reports, hasLength(1));
        expect(reports.single.method, 'PATCH');
        expect(reports.single.resource, 'visits');
        expect(reports.single.message, 'column visits.foo does not exist');
      },
    );

    test(
      'one failure is reported once, then not again for ten minutes',
      () async {
        var now = DateTime(2026, 10, 29, 9);
        final client = over(
          MockClient(
            (request) async => http.Response(
              '',
              503,
              headers: _fromSupabase,
              request: request,
            ),
          ),
          now: () => now,
        );
        await client.get(_url('/rest/v1/stores'));
        await client.get(_url('/rest/v1/stores'));
        await client.get(_url('/rest/v1/orders'));
        expect(reports.map((r) => r.resource), ['stores', 'orders']);
        now = now.add(FailureReportClient.quiet);
        await client.get(_url('/rest/v1/stores'));
        expect(reports, hasLength(3));
      },
    );

    test(
      "a Wi-Fi sign-in page answering in Supabase's place is not reported",
      () async {
        final client = over(
          MockClient(
            (request) async => http.Response(
              '<html>Log in to Store WiFi</html>',
              503,
              request: request,
            ),
          ),
        );
        final response = await client.get(_url('/rest/v1/stores'));
        expect(response.statusCode, 503);
        expect(reports, isEmpty);
      },
    );

    test('a reporter that throws changes nothing for the caller', () async {
      final client = FailureReportClient(
        inner: MockClient(
          (request) async => http.Response(
            'Bad gateway',
            502,
            headers: _fromSupabase,
            request: request,
          ),
        ),
        report: (_) => throw StateError('Sentry is down'),
      );
      final response = await client.get(_url('/rest/v1/stores'));
      expect(response.statusCode, 502);
      expect(response.body, 'Bad gateway');
    });

    test('a refusal retried and then worked is not reported', () async {
      final answers = [
        (http.Request r) => http.Response(
          jsonEncode({'code': 'PGRST303', 'message': 'JWT issued at future'}),
          401,
          headers: _json,
          request: r,
        ),
        (http.Request r) =>
            http.Response('[]', 200, headers: _json, request: r),
      ];
      final client = FailureReportClient(
        inner: SkewRetryClient(
          inner: MockClient((request) async => answers.removeAt(0)(request)),
          sleep: (_) async {},
        ),
        report: reports.add,
      );
      final response = await client.get(_url('/rest/v1/stores'));
      expect(response.statusCode, 200);
      expect(reports, isEmpty);
    });

    test(
      "a real SupabaseClient still gets the database's error to show",
      () async {
        final supabase = SupabaseClient(
          _api,
          'publishable',
          httpClient: over(
            MockClient(
              (request) async => http.Response(
                jsonEncode({
                  'code': '23503',
                  'message': 'violates foreign key constraint',
                  'details': null,
                  'hint': null,
                }),
                409,
                headers: _json,
                request: request,
              ),
            ),
          ),
          authOptions: const AuthClientOptions(autoRefreshToken: false),
        );
        await expectLater(
          supabase.from('visits').insert({'store_id': 's1'}),
          throwsA(
            isA<PostgrestException>().having((e) => e.code, 'code', '23503'),
          ),
        );
        expect(reports.single.resource, 'visits');
        await supabase.dispose();
      },
    );
  });
}
