import 'dart:convert';

import 'package:http/http.dart' as http;

/// The HTTP client the app's [SupabaseClient] is given.
///
/// Now and then the API refuses a good token as "JWT issued at future"
/// (PGRST303, HTTP 401): the server that checked the token was a moment behind
/// the clock of the one that issued it. The production logs show about one a
/// day, from the phones, the browser and the web server alike, and the same
/// token works straight after (14 Oct 2026: a rep's `GET /profiles` refused).
/// On the phone a refused read showed an error, and a refused sync write spent
/// one of its attempts.
///
/// So a request refused that way is sent once more after a short pause. Only
/// that refusal: the token is checked before the database runs anything, so a
/// write sent again cannot happen twice. Anything else, including a second
/// refusal, comes back as it was. The web app does the same in
/// `web/lib/supabase/fetch.ts`.
class SkewRetryClient extends http.BaseClient {
  SkewRetryClient({http.Client? inner, Future<void> Function(Duration)? sleep})
    : _inner = inner ?? http.Client(),
      _sleep = sleep ?? Future<void>.delayed;

  /// How long to wait before sending a refused request again.
  static const retryDelay = Duration(milliseconds: 250);

  final http.Client _inner;
  final Future<void> Function(Duration) _sleep;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await _inner.send(request);
    if (response.statusCode != 401 || !_canSendAgain(request)) return response;

    // The answer has to be read to see why it was refused; hand the caller a
    // fresh copy of it when it is not this refusal.
    final bytes = await response.stream.toBytes();
    if (!_issuedAtFuture(bytes)) return _replay(response, bytes);

    await _sleep(retryDelay);
    return _inner.send(_copyOf(request as http.Request));
  }

  @override
  void close() => _inner.close();

  /// The API's requests carry their whole body in memory ([http.Request]). A
  /// streamed or multipart body has been read already, and an abortable one
  /// would lose its trigger in a copy, so those are never sent twice.
  static bool _canSendAgain(http.BaseRequest request) =>
      request is http.Request && request is! http.Abortable;

  static bool _issuedAtFuture(List<int> bytes) {
    try {
      final body = jsonDecode(utf8.decode(bytes, allowMalformed: true));
      return body is Map && body['code'] == 'PGRST303';
    } on FormatException {
      return false;
    }
  }

  /// A request can only be sent once, so the second one is a copy.
  static http.Request _copyOf(http.Request request) =>
      http.Request(request.method, request.url)
        ..headers.addAll(request.headers)
        ..followRedirects = request.followRedirects
        ..maxRedirects = request.maxRedirects
        ..persistentConnection = request.persistentConnection
        ..bodyBytes = request.bodyBytes;

  static http.StreamedResponse _replay(
    http.StreamedResponse response,
    List<int> bytes,
  ) => http.StreamedResponse(
    Stream.value(bytes),
    response.statusCode,
    contentLength: bytes.length,
    request: response.request,
    headers: response.headers,
    isRedirect: response.isRedirect,
    persistentConnection: response.persistentConnection,
    reasonPhrase: response.reasonPhrase,
  );
}
