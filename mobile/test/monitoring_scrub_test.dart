// `Monitoring.scrub` is the last thing between a rep's session token and
// Sentry, and it had no coverage at all — including while it was rewritten for
// the sentry_flutter 9.x upgrade, where `SentryEvent.copyWith` was deprecated
// and every field had to be reassigned by hand.
//
// A mistake here is silent: the event still sends, the crash still appears in
// the dashboard, and the credential rides along inside it.

import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'package:gf_merch_rep/core/monitoring.dart';

SentryEvent eventWith(SentryRequest? request, {String environment = 'production'}) {
  final e = SentryEvent();
  e.environment = environment;
  e.request = request;
  return e;
}

void main() {
  test('a debug build never reaches the shared issue stream', () {
    final event = eventWith(null, environment: 'development');
    expect(Monitoring.scrub(event, Hint()), isNull);
  });

  test('credential headers are stripped, ordinary ones kept', () {
    final request = SentryRequest(
      url: 'https://example.test/v1/visits',
      headers: {
        'Authorization': 'Bearer secret-token-value',
        'apikey': 'sb_publishable_xxx',
        'X-Refresh-Token': 'refresh-me',
        'X-Client-Secret': 'hunter2',
        // Both of these got through the first version of this function, which
        // compared against the literal lowercase `apikey` and never looked at
        // the Cookie *header* at all — only at SentryRequest.cookies.
        'X-Api-Key': 'sb_secret_yyy',
        'Cookie': 'sb-access-token=abc123; other=1',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    );

    final out = Monitoring.scrub(eventWith(request), Hint())!;
    final headers = out.request!.headers;

    expect(headers.keys.map((k) => k.toLowerCase()), isNot(contains('authorization')));
    expect(headers.keys.map((k) => k.toLowerCase()), isNot(contains('apikey')));
    expect(headers.keys.map((k) => k.toLowerCase()),
        isNot(contains('x-refresh-token')),
        reason: 'anything containing "token" goes, not just the exact name');
    expect(headers.keys.map((k) => k.toLowerCase()),
        isNot(contains('x-client-secret')),
        reason: 'anything containing "secret" goes');
    expect(headers.keys.map((k) => k.toLowerCase()),
        isNot(contains('x-api-key')),
        reason: 'hyphenated spellings are the same header as apikey');
    expect(headers.keys.map((k) => k.toLowerCase()), isNot(contains('cookie')),
        reason: 'the Cookie header is not SentryRequest.cookies and carries '
            'the session just the same');

    // The point is to keep the event useful, not to empty it.
    expect(headers['Content-Type'], 'application/json');
    expect(headers['Accept'], 'application/json');

    // And nothing survives by value either.
    expect(headers.values.join(' '), isNot(contains('secret-token-value')));
    expect(headers.values.join(' '), isNot(contains('hunter2')));
    expect(headers.values.join(' '), isNot(contains('sb_secret_yyy')));
    expect(headers.values.join(' '), isNot(contains('sb-access-token')));
  });

  test('cookies are dropped', () {
    final request = SentryRequest(
      url: 'https://example.test/v1/visits',
      cookies: 'sb-access-token=abc123; other=1',
    );
    final out = Monitoring.scrub(eventWith(request), Hint())!;
    expect(out.request!.cookies, isNull);
  });

  test('a query string is cut off the URL, and the path survives', () {
    // Auth redirects carry recovery and access tokens here.
    final request = SentryRequest(
      url: 'https://example.test/reset#/?access_token=abc&refresh_token=def',
    );
    final out = Monitoring.scrub(eventWith(request), Hint())!;

    expect(out.request!.url, 'https://example.test/reset#/');
    expect(out.request!.url, isNot(contains('access_token')));
    expect(out.request!.queryString, isNull);
  });

  test('queryString is cleared even when the URL has no question mark', () {
    // The deliberate difference from the pre-9.x version, which only cleared
    // it inside the `url contains '?'` branch. `queryString` is its own field
    // and can carry parameters the URL does not, so that left a way through.
    final request = SentryRequest(
      url: 'https://example.test/v1/visits',
      queryString: 'access_token=abc&refresh_token=def',
    );
    final out = Monitoring.scrub(eventWith(request), Hint())!;

    expect(out.request!.url, 'https://example.test/v1/visits');
    expect(out.request!.queryString, isNull,
        reason: 'a token here must not depend on the URL shape');
  });

  test('an event with no request is passed through untouched', () {
    final out = Monitoring.scrub(eventWith(null), Hint());
    expect(out, isNotNull);
    expect(out!.request, isNull);
  });
}
