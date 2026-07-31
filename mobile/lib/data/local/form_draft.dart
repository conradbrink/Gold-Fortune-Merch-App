import 'dart:convert';
import 'dart:io';

import '../repositories/form_repository.dart';
import 'app_database.dart';

/// A half-filled audit, written to disk so it survives the app being killed.
///
/// Android reclaims memory by killing whatever is in the background, and on a
/// 4 GB phone opening the camera is very likely to make the app the thing it
/// picks. The process dies, Flutter restarts at the home screen, and every
/// answer held in `State` goes with it — which is exactly what reps were
/// seeing: a required photo is the first field of the audit, so the form could
/// not be completed at all.
///
/// Nothing here assumes the app gets a chance to clean up. The draft is
/// rewritten after every change and immediately before the camera is opened,
/// because after that call there may be no further code running.
class FormDraft {
  const FormDraft({
    required this.answers,
    this.pendingPhotoFieldId,
    this.savedAt,
  });

  final Map<String, FormAnswer> answers;

  /// The field whose camera was open when we last wrote. After a kill this is
  /// how we know which answer the recovered photo belongs to — `image_picker`
  /// hands back a file with no clue as to what it was for.
  final String? pendingPhotoFieldId;

  final DateTime? savedAt;

  static String keyFor({
    required String visitClientGeneratedId,
    required String templateId,
  }) =>
      'form_draft:$visitClientGeneratedId:$templateId';

  String encode() => jsonEncode({
        'saved_at': (savedAt ?? DateTime.now()).toIso8601String(),
        'pending_photo_field_id': pendingPhotoFieldId,
        'answers': answers.map((fieldId, a) => MapEntry(fieldId, {
              'text': a.text,
              'number': a.number,
              'boolean': a.boolean,
              'date': a.date?.toIso8601String(),
              'photo_path': a.photo?.path,
              'photo_client_id': a.photoClientId,
            })),
      });

  static FormDraft? decode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      final answers = <String, FormAnswer>{};
      final stored = (map['answers'] as Map<String, dynamic>?) ?? const {};

      stored.forEach((fieldId, value) {
        final a = value as Map<String, dynamic>;
        final path = a['photo_path'] as String?;
        // A path that no longer resolves is dropped rather than restored. The
        // OS can reclaim its temp directory, and `Image.file` on a missing
        // file throws during paint, which would replace a recoverable form
        // with a broken screen.
        final photo = (path != null && File(path).existsSync())
            ? File(path)
            : null;

        answers[fieldId] = FormAnswer()
          ..text = a['text'] as String?
          ..number = a['number'] as num?
          ..boolean = a['boolean'] as bool?
          ..date =
              a['date'] == null ? null : DateTime.tryParse(a['date'] as String)
          ..photo = photo
          ..photoClientId = photo == null ? null : a['photo_client_id'] as String?;
      });

      return FormDraft(
        answers: answers,
        pendingPhotoFieldId: map['pending_photo_field_id'] as String?,
        savedAt: map['saved_at'] == null
            ? null
            : DateTime.tryParse(map['saved_at'] as String),
      );
    } catch (_) {
      // A corrupt draft must never block the form. Losing it is the same
      // outcome as before this existed; throwing here would be worse.
      return null;
    }
  }
}

/// Reads and writes drafts through the existing key/value table, so this needs
/// no schema change and therefore no drift migration.
class FormDraftStore {
  const FormDraftStore(this._db);

  final AppDatabase _db;

  /// Long enough to cover a rep who is interrupted and comes back after a
  /// weekend, short enough that an abandoned visit does not keep its draft —
  /// and the photo file it points at — on the handset indefinitely.
  static const maxAge = Duration(days: 7);

  Future<FormDraft?> load({
    required String visitClientGeneratedId,
    required String templateId,
  }) async {
    final raw = await _db.getValue(FormDraft.keyFor(
      visitClientGeneratedId: visitClientGeneratedId,
      templateId: templateId,
    ));

    final draft = FormDraft.decode(raw);
    final savedAt = draft?.savedAt;
    if (draft == null ||
        (savedAt != null && DateTime.now().difference(savedAt) > maxAge)) {
      // Also clears the key when decoding failed, so a corrupt value is not
      // re-read on every open.
      if (raw != null) {
        await clear(
          visitClientGeneratedId: visitClientGeneratedId,
          templateId: templateId,
        );
      }
      return null;
    }
    return draft;
  }

  Future<void> save({
    required String visitClientGeneratedId,
    required String templateId,
    required FormDraft draft,
  }) {
    return _db.setValue(
      FormDraft.keyFor(
        visitClientGeneratedId: visitClientGeneratedId,
        templateId: templateId,
      ),
      draft.encode(),
    );
  }

  Future<void> clear({
    required String visitClientGeneratedId,
    required String templateId,
  }) {
    return _db.deleteValue(FormDraft.keyFor(
      visitClientGeneratedId: visitClientGeneratedId,
      templateId: templateId,
    ));
  }
}
