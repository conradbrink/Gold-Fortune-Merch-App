// The phone sends a request once more when the API refuses a good token as
// "JWT issued at future" (PGRST303), and only then. The last group runs a real
// `SupabaseClient` over a fake PostgREST, so what is asserted is what a sync
// write and a screen's read actually get back.

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/skew_retry_client.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _json = {'content-type': 'application/json'};

typedef Answer = http.Response Function(http.Request request);

/// The request rides along because postgrest reads `response.request!`.
Answer ok(Object body, {int status = 200}) =>
    (request) => http.Response(
      jsonEncode(body),
      status,
      headers: _json,
      request: request,
    );

final Answer issuedAtFuture = ok({
  'code': 'PGRST303',
  'details': null,
  'hint': null,
  'message': 'JWT issued at future',
}, status: 401);

/// A fake API that answers from a list, and remembers what it was asked.
class Scripted {
  Scripted(this.answers);

  final List<Answer> answers;
  final requests = <http.Request>[];

  http.Client get client => MockClient((request) async {
    requests.add(request);
    if (answers.isEmpty) fail('asked once too often');
    return answers.removeAt(0)(request);
  });
}

void main() {
  late List<Duration> waits;
  Future<void> sleep(Duration d) async => waits.add(d);

  setUp(() => waits = []);

  test('a request refused as issued in the future is sent once more, after a pause', () async {
    final api = Scripted([issuedAtFuture, ok([{'id': 'p1'}])]);
    final client = SkewRetryClient(inner: api.client, sleep: sleep);

    final response = await client.get(Uri.parse('https://x.supabase.co/rest/v1/profiles'));

    expect(response.statusCode, 200);
    expect(jsonDecode(response.body), [{'id': 'p1'}]);
    expect(api.requests, hasLength(2));
    expect(waits, [SkewRetryClient.retryDelay]);
  });

  test('a write is sent again with the same method, headers and body', () async {
    final api = Scripted([issuedAtFuture, ok({}, status: 201)]);
    final client = SkewRetryClient(inner: api.client, sleep: sleep);

    final response = await client.post(
      Uri.parse('https://x.supabase.co/rest/v1/visits'),
      headers: {'content-type': 'application/json', 'Prefer': 'return=minimal'},
      body: jsonEncode({'store_id': 's1'}),
    );

    expect(response.statusCode, 201);
    final [first, second] = api.requests;
    expect(second.method, 'POST');
    expect(second.url, first.url);
    expect(second.body, first.body);
    expect(second.headers['prefer'], 'return=minimal');
  });

  test('it is sent again only once: a second refusal reaches the caller', () async {
    final api = Scripted([issuedAtFuture, issuedAtFuture]);
    final client = SkewRetryClient(inner: api.client, sleep: sleep);

    final response = await client.get(Uri.parse('https://x.supabase.co/rest/v1/stores'));

    expect(response.statusCode, 401);
    expect(jsonDecode(response.body)['code'], 'PGRST303');
    expect(api.requests, hasLength(2));
  });

  test('other refusals and answers are not sent again, and can still be read', () async {
    final answers = <Answer>[
      ok({'code': 'PGRST301', 'message': 'JWT expired'}, status: 401),
      (r) => http.Response('Unauthorized', 401, request: r),
      ok([{'id': 's1'}]),
    ];
    for (final answer in answers) {
      final api = Scripted([answer]);
      final client = SkewRetryClient(inner: api.client, sleep: sleep);

      final response = await client.get(Uri.parse('https://x.supabase.co/rest/v1/stores'));

      expect(api.requests, hasLength(1));
      expect(waits, isEmpty);
      expect(response.body, isNotEmpty, reason: 'the caller can still read the body');
    }
  });

  test('a streamed body is never sent twice', () async {
    var sent = 0;
    final inner = MockClient.streaming((request, body) async {
      sent++;
      await body.drain<void>();
      return http.StreamedResponse(
        Stream.value(utf8.encode(jsonEncode({'code': 'PGRST303'}))),
        401,
        request: request,
      );
    });
    final client = SkewRetryClient(inner: inner, sleep: sleep);
    final request = http.StreamedRequest('POST', Uri.parse('https://x.supabase.co/storage/v1/object/photos/a.jpg'));
    request.sink
      ..add([1, 2, 3])
      ..close();

    final response = await client.send(request);

    expect(response.statusCode, 401);
    expect(sent, 1);
  });

  group('through a real SupabaseClient', () {
    test('a screen read gets its rows after one refusal', () async {
      final api = Scripted([issuedAtFuture, ok([{'id': 'p1', 'full_name': 'Test Rep'}])]);
      final supabase = SupabaseClient(
        'https://x.supabase.co',
        'sb_publishable_test',
        httpClient: SkewRetryClient(inner: api.client, sleep: sleep),
      );

      final rows = await supabase.from('profiles').select('id, full_name');

      expect(rows, [{'id': 'p1', 'full_name': 'Test Rep'}]);
      expect(api.requests, hasLength(2));
      await supabase.dispose();
    });

    test('a refused write is sent again once, and lands', () async {
      final api = Scripted([issuedAtFuture, ok([], status: 201)]);
      final supabase = SupabaseClient(
        'https://x.supabase.co',
        'sb_publishable_test',
        httpClient: SkewRetryClient(inner: api.client, sleep: sleep),
      );

      await supabase.from('location_pings').insert({'client_id': 'c1'});

      expect(api.requests.map((r) => r.method), ['POST', 'POST']);
      expect(api.requests.last.body, api.requests.first.body);
      await supabase.dispose();
    });
  });
}
