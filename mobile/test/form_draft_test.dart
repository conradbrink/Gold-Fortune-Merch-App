// The audit form could not be completed at all on a 4 GB handset.
//
// Its first field is a required photo, and opening the camera makes Android
// very likely to kill the app to free memory. The process dies, Flutter
// restarts at the home screen, and every answer — held only in `State` — goes
// with it. Reps reported being "kicked out" on every attempt, at every store.
//
// These tests recreate that kill. Nothing here simulates it by calling a
// method that hints at it: the widget is torn down completely and a fresh one
// is built against the same database, which is what the rep actually gets
// after Android restarts the app.

import 'dart:io';

import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/core/providers.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/form_draft.dart';
import 'package:gf_merch_rep/data/models/form_template.dart';
import 'package:gf_merch_rep/data/repositories/form_repository.dart';
import 'package:gf_merch_rep/features/forms/form_fill_screen.dart';

/// The real "Merchandising Conditions Audit", trimmed to the shapes that
/// matter here. The photo is first and required, exactly as in production —
/// that ordering is why the form was unusable rather than merely lossy.
const _template = FormTemplate(
  id: 'template-1',
  name: 'Merchandising Conditions Audit',
  fields: [
    FormFieldDef(
      id: 'f-photo',
      label: 'Shelf photo — before restocking',
      fieldType: 'photo',
      options: [],
      required: true,
      sortOrder: 0,
    ),
    FormFieldDef(
      id: 'f-stock',
      label: 'Was our product in stock on the shelf?',
      fieldType: 'boolean',
      options: [],
      required: true,
      sortOrder: 1,
    ),
    FormFieldDef(
      id: 'f-facings',
      label: 'How many facings does our product have?',
      fieldType: 'number',
      options: [],
      required: true,
      sortOrder: 2,
    ),
    FormFieldDef(
      id: 'f-position',
      label: 'Where is the product located on the shelf?',
      fieldType: 'multiple_choice',
      options: ['Eye-level', 'Middle', 'Bottom', 'Top'],
      required: true,
      sortOrder: 3,
    ),
    FormFieldDef(
      id: 'f-notes',
      label: 'Competitor activity observed',
      fieldType: 'text',
      options: [],
      required: false,
      sortOrder: 4,
    ),
  ],
);

const _visitId = 'visit-abc';

void main() {
  late AppDatabase db;

  setUp(() {
    db = AppDatabase.forTesting(
      DatabaseConnection(NativeDatabase.memory()),
    );
  });

  tearDown(() => db.close());

  Widget app() => ProviderScope(
        overrides: [appDatabaseProvider.overrideWithValue(db)],
        child: const MaterialApp(
          home: FormFillScreen(
            template: _template,
            visitClientGeneratedId: _visitId,
          ),
        ),
      );

  /// Fills in three answers of three different kinds.
  Future<void> fillSomeIn(WidgetTester tester) async {
    await tester.tap(find.text('Yes').first);
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byType(TextFormField).at(0), // facings
      '6',
    );
    await tester.tap(find.text('Eye-level'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byType(TextFormField).at(1), // competitor notes
      'Rival ran a gondola end',
    );
    // Past the debounce that keeps typing off sqlite on every keystroke.
    await tester.pump(const Duration(milliseconds: 500));
  }

  testWidgets('answers survive the app being killed while the camera is open',
      (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    await fillSomeIn(tester);

    // The kill. The widget tree goes away entirely, as it does when Android
    // reclaims the process, and a brand new screen is built afterwards.
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();

    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    expect(find.text('Rival ran a gondola end'), findsOneWidget,
        reason: 'typed text should come back');
    expect(find.text('6'), findsOneWidget,
        reason: 'the number should come back');
    expect(
      find.text('Your answers were saved — carry on where you left off.'),
      findsOneWidget,
      reason: 'the rep should be told, not left guessing',
    );
  });

  testWidgets('a form that was never started restores nothing and says nothing',
      (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();

    expect(
      find.text('Your answers were saved — carry on where you left off.'),
      findsNothing,
      reason: 'no draft means no claim that anything was recovered',
    );
  });

  group('draft encoding', () {
    test('round-trips every answer type', () {
      final answers = {
        'f-stock': FormAnswer()..boolean = true,
        'f-facings': FormAnswer()..number = 6,
        'f-position': FormAnswer()..text = 'Eye-level',
        'f-date': FormAnswer()..date = DateTime.utc(2026, 7, 31, 9, 30),
      };

      final restored = FormDraft.decode(
        FormDraft(answers: answers, pendingPhotoFieldId: 'f-photo').encode(),
      )!;

      expect(restored.answers['f-stock']!.boolean, isTrue);
      expect(restored.answers['f-facings']!.number, 6);
      expect(restored.answers['f-position']!.text, 'Eye-level');
      expect(restored.answers['f-date']!.date, DateTime.utc(2026, 7, 31, 9, 30));
      expect(restored.pendingPhotoFieldId, 'f-photo');
    });

    test('drops a photo whose file the OS has since reclaimed', () {
      // Restoring a path that no longer resolves would throw while painting
      // Image.file, turning a recoverable form into a broken screen.
      final raw = FormDraft(answers: {
        'f-photo': FormAnswer()
          ..photo = File('/tmp/definitely-not-here-${DateTime.now()}.jpg')
          ..photoClientId = 'photo-1',
      }).encode();

      final restored = FormDraft.decode(raw)!;

      expect(restored.answers['f-photo']!.photo, isNull);
      expect(restored.answers['f-photo']!.photoClientId, isNull,
          reason: 'the id must not outlive the file it refers to');
    });

    test('a corrupt draft is discarded rather than blocking the form', () {
      expect(FormDraft.decode('{not json'), isNull);
      expect(FormDraft.decode(''), isNull);
      expect(FormDraft.decode(null), isNull);
    });
  });
}
