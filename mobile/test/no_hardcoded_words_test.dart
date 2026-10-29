// No business word is written into the app's screens. The company's own
// words come from the Terms helper (lib/core/terms.dart); this test reads the
// source and fails on a string a person would read that names a store, visit,
// rep and so on directly — the phone's half of
// web/tests/no-hardcoded-words.test.ts.
//
// What counts: a string literal that reads as prose (has a space, or is one
// capitalised word like "Stores"), with `${...}` interpolations taken out
// first — `${visit.endAt}` is code, not a word. What does not: comments,
// routes ("/visit/:key"), role and table codes ('rep', 'stores'), and Supabase
// select lists ('id, visits(status)').
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

final _words = RegExp(
  r'\b(stores?|visits?|reps?|representatives?|chains?|territor(?:y|ies)|customers?|outlets?|shops?|merchandis\w*|call cycles?|gold fortune)\b',
  caseSensitive: false,
);

/// Plain-English uses, each with the reason it is not a business word.
const _allowed = <String, String>{
  // A verb after a count of sites: "3 stores to visit today."
  'to visit today': 'the verb "to visit", not the job noun',
  // The Sentry release name, an identifier kept unchanged so crash history
  // stays continuous across the rename.
  'gf-merch-rep@': 'Sentry release tag, not shown to anyone',
};

final _literal = RegExp(r"'((?:[^'\\]|\\.)*)'" r'|"((?:[^"\\]|\\.)*)"');
final _interpolation = RegExp(r'\$\{[^}]*\}|\$\w+');
// An interpolation the line regex cut short (a quote inside `${...}`): code
// to the end of the match, not words.
final _openInterpolation = RegExp(r'\$\{.*$');
final _selectList = RegExp(r'^[a-z_*][a-z0-9_,\s.*!:()>-]*$');

List<String> findHardcodedWords(String path, String source) {
  final found = <String>[];
  final withoutBlockComments = source.replaceAll(RegExp(r'/\*[\s\S]*?\*/'), '');
  final lines = withoutBlockComments.split('\n');
  for (var i = 0; i < lines.length; i++) {
    final line = lines[i].trimLeft();
    if (line.startsWith('//')) continue;
    for (final m in _literal.allMatches(lines[i])) {
      final raw = m.group(1) ?? m.group(2) ?? '';
      final text = raw.replaceAll(_interpolation, ' ').replaceAll(_openInterpolation, ' ').trim();
      if (!_words.hasMatch(text)) continue;
      final prose = text.contains(' ') || RegExp(r'^[A-Z][a-z]+s?$').hasMatch(text);
      if (!prose || text.startsWith('/') || _selectList.hasMatch(text)) continue;
      if (_allowed.keys.any(text.contains)) continue;
      found.add('$path:${i + 1}  "$text"');
    }
  }
  return found;
}

void main() {
  test('no screen hard-codes a business word', () {
    final findings = <String>[];
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      if (entity.path.endsWith('core/terms.dart')) continue; // the defaults themselves
      findings.addAll(findHardcodedWords(entity.path, entity.readAsStringSync()));
    }
    expect(
      findings,
      isEmpty,
      reason: 'Hard-coded business words. Use the Terms helper '
          '(lib/core/terms.dart), or add a plain-English use to _allowed with a reason.',
    );
  });

  test('the guard sees what a person would read, and nothing else', () {
    const src = '''
      // A comment about the store.
      final a = 'Search stores';
      final b = '/visit/\$key';
      final c = 'rep';
      final d = 'id, visits(status)';
      final e = '\${visit.endAt} done';
      final f = "Every visit logged";
    ''';
    final hits = findHardcodedWords('x.dart', src);
    expect(hits.length, 2);
    expect(hits[0], contains('Search stores'));
    expect(hits[1], contains('Every visit logged'));
  });
}
