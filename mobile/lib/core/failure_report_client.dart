import 'dart:convert';

import 'package:http/http.dart' as http;

import 'monitoring.dart';

/// A Supabase request that failed in a way that means something is broken.
class SupabaseFailure {
  const SupabaseFailure({
    required this.service,
    required this.method,
    required this.resource,
    required this.status,
    required this.code,
    required this.message,
  });

  /// "database", "files", "sign-in", "function" or "supabase".
  final String service;
  final String method;

  /// The table, `rpc/<function>`, `object/<bucket>` or endpoint; never ids or
  /// file names.
  final String resource;
  final int status;

  /// The PostgREST or Postgres code, when the answer had one.
  final String code;
  final String message;

  /// What Sentry groups on: one issue per table or function and code.
  String get key =>
      '$service $method ${resource.isEmpty ? '/' : resource} '
      '${code.isEmpty ? 'HTTP $status' : code}';
}

/// Reports to Sentry the failures a screen catches and shows, which Sentry,
/// hearing only of errors nobody caught, would otherwise never learn of.
///
/// Wraps the client the app's [SupabaseClient] is given, outside
/// SkewRetryClient, so a refusal that was retried and then worked is not
/// reported. The rules match `failureOf` in `web/lib/supabase/fetch.ts`:
///
/// Not reported, because it is the app working: a function's own refusal
/// (22023 bad input, 42501 in its own words, P0002 not found, a duplicate or
/// check the screen turns into a message, and the 40001/54000/55000 ones
/// PostgREST answers with a 500), anything from `/auth/v1` short of a server
/// error, every 401, `.single()` finding no row (PGRST116) and a page past the
/// end (PGRST103). A phone with no signal throws rather than answers, and a
/// Wi-Fi sign-in page that answers instead carries no `sb-` header, so
/// neither is reported.
///
/// Reported: a server error from any part of Supabase; a request the schema
/// does not match (PGRST1xx/2xx); an error only Postgres raises (a missing
/// column, a broken foreign key, a timeout); and row-level security refusing a
/// signed-in rep.
///
/// The same failure goes at most once every [quiet], because the sync engine
/// sends a refused write again and again, and without this one stuck entry
/// would spend the month's Sentry allowance. Only the table or bucket, the
/// code and the database's sentence are sent: never the query string, the
/// body or `details`, which carry the values.
class FailureReportClient extends http.BaseClient {
  FailureReportClient({
    http.Client? inner,
    void Function(SupabaseFailure failure)? report,
    DateTime Function()? now,
  }) : _inner = inner ?? http.Client(),
       _report = report ?? Monitoring.reportSupabaseFailure,
       _now = now ?? DateTime.now;

  /// How long the phone keeps quiet about a failure it has reported.
  static const quiet = Duration(minutes: 10);

  final http.Client _inner;
  final void Function(SupabaseFailure failure) _report;
  final DateTime Function() _now;
  final _lastReported = <String, DateTime>{};

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await _inner.send(request);
    if (response.statusCode < 400 || response.statusCode == 401) {
      return response;
    }
    // Supabase stamps its answers (`sb-request-id`, `sb-project-ref`). A
    // shop's Wi-Fi sign-in page or a carrier's proxy answering in its place
    // does not, and its 503 is not ours to fix.
    if (!response.headers.keys.any((k) => k.toLowerCase().startsWith('sb-'))) {
      return response;
    }

    // The answer has to be read to see why it failed; hand the caller a fresh
    // copy of it.
    final bytes = await response.stream.toBytes();
    try {
      final failure = failureOf(
        request.url,
        request.method,
        response.statusCode,
        _json(bytes),
      );
      if (failure != null && _firstInAWhile(failure.key)) _report(failure);
    } catch (_) {
      // A failure to report must not become a second failure.
    }
    return http.StreamedResponse(
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

  @override
  void close() => _inner.close();

  bool _firstInAWhile(String key) {
    final now = _now();
    final last = _lastReported[key];
    if (last != null && now.difference(last) < quiet) return false;
    _lastReported[key] = now;
    return true;
  }

  static Object? _json(List<int> bytes) {
    try {
      return jsonDecode(utf8.decode(bytes, allowMalformed: true));
    } on FormatException {
      return null;
    }
  }

  /// Postgres codes only the engine raises, never a function's own `raise`.
  static const _engineCodes = {'23502', '23503', '22P02', '22001', '57014'};

  /// Whole classes: 42 (bad SQL, apart from 42501), 08 (connection), 53
  /// (resources), XX (internal).
  static const _engineClasses = ['42', '08', '53', 'XX'];

  /// Codes our functions raise on purpose that PostgREST answers with a 5xx.
  static const _refusalsAsServerErrors = {'40001', '54000', '55000', 'P0001'};

  /// PostgREST codes that are the app working, not failing.
  static const _expectedPostgrest = {'PGRST103', 'PGRST116'};

  /// Storage words that come before the bucket: `/object/sign/<bucket>/…`.
  static const _storageVerbs = {
    'sign',
    'list',
    'public',
    'authenticated',
    'upload',
    'info',
    'move',
    'copy',
  };

  static const _services = {
    'rest': 'database',
    'storage': 'files',
    'auth': 'sign-in',
    'functions': 'function',
  };

  /// The engine's own wording for a refusal; a function's 42501 says
  /// something else.
  static final _engineRefusal = RegExp(
    r'row-level security|permission denied for',
    caseSensitive: false,
  );

  static final _postgrestRequestOrSchema = RegExp(r'^PGRST[12]\d\d$');

  /// The failure to report for an answer, or null when it is not one. `body`
  /// is the answer's JSON, or null when it had none.
  static SupabaseFailure? failureOf(
    Uri url,
    String method,
    int status,
    Object? body,
  ) {
    if (status < 400 || status == 401) return null;
    final path = url.pathSegments.where((s) => s.isNotEmpty).toList();
    // /rest/v1/orders, /storage/v1/object/<bucket>/<path>, /auth/v1/token …
    final service = _services[path.isEmpty ? '' : path.first] ?? 'supabase';
    final rest = path.length > 2 ? path.sublist(2) : const <String>[];
    final String resource;
    if (service == 'files') {
      final bucket = rest.skip(1).where((s) => !_storageVerbs.contains(s));
      resource = [
        if (rest.isNotEmpty) rest.first,
        if (bucket.isNotEmpty) bucket.first,
      ].join('/');
    } else {
      resource = rest
          .take(rest.isNotEmpty && rest.first == 'rpc' ? 2 : 1)
          .join('/');
    }

    final answer = body is Map ? body : const {};
    final code = answer['code'] is String ? answer['code'] as String : '';
    final said = answer['message'] is String ? answer['message'] as String : '';
    // A data error (22xxx) ends with the value that was refused: `invalid
    // input syntax for type uuid: "…"`. Keep the sentence, not what was typed.
    final sentence = code.startsWith('22') ? said.split(': ').first : said;
    final failure = SupabaseFailure(
      service: service,
      method: method.toUpperCase(),
      resource: resource,
      status: status,
      code: code,
      message: sentence.length > 300 ? sentence.substring(0, 300) : sentence,
    );

    if (status >= 500) {
      return _refusalsAsServerErrors.contains(code) ? null : failure;
    }
    if (service == 'sign-in' || service == 'function') return null;
    if (_engineRefusal.hasMatch(said)) return failure;
    if (_postgrestRequestOrSchema.hasMatch(code)) {
      return _expectedPostgrest.contains(code) ? null : failure;
    }
    if (_engineCodes.contains(code)) return failure;
    if (code != '42501' && _engineClasses.any(code.startsWith)) return failure;
    return null;
  }
}
