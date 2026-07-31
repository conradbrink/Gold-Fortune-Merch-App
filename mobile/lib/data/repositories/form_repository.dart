import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:geolocator/geolocator.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/location_service.dart';
import '../local/app_database.dart';
import '../local/outbox_types.dart';
import '../models/form_template.dart';
import '../sync/sync_engine.dart';

const _uuid = Uuid();

class FormAnswer {
  String? text;
  num? number;
  bool? boolean;
  DateTime? date;
  File? photo;

  /// Set once the photo has been copied somewhere durable, and it is the same
  /// id the submission is queued under. Without it a draft restored after the
  /// app was killed would re-copy a file it already owns, and the photo the
  /// rep actually took would be filed under a second id.
  String? photoClientId;

  bool get isEmpty =>
      text == null &&
      number == null &&
      boolean == null &&
      date == null &&
      photo == null;
}

class FormRepository {
  FormRepository(this._client, this._db, this._sync);

  final SupabaseClient _client;
  final AppDatabase _db;
  final SyncEngine _sync;

  static const _templatesKey = 'form_templates';

  /// Templates are cached on every successful fetch: a rep who loses signal
  /// between opening the app and reaching the store still has their forms.
  Future<List<FormTemplate>> fetchActiveTemplates() async {
    try {
      final rows = await _client
          .from('form_templates')
          .select(
              'id, name, description, form_fields(id, label, field_type, options, required, sort_order)')
          .eq('active', true)
          .order('name', ascending: true);

      final templates = (rows as List)
          .map((r) => FormTemplate.fromMap(r as Map<String, dynamic>))
          .toList();

      await _db.setValue(
        _templatesKey,
        jsonEncode(templates.map((t) => t.toMap()).toList()),
      );
      return templates;
    } catch (_) {
      return _cachedTemplates();
    }
  }

  Future<List<FormTemplate>> _cachedTemplates() async {
    final raw = await _db.getValue(_templatesKey);
    if (raw == null) return [];
    return (jsonDecode(raw) as List)
        .map((t) => FormTemplate.fromMap(t as Map<String, dynamic>))
        .toList();
  }

  /// Templates already submitted for this visit — counting submissions still
  /// sitting in the outbox, so a form filled in offline immediately shows as
  /// done and can't be filled in twice.
  Future<Set<String>> fetchSubmittedTemplateIds(String visitClientId) async {
    final ids = await pendingTemplateIds(visitClientId);

    try {
      final visit = await _client
          .from('visits')
          .select('id')
          .eq('client_generated_id', visitClientId)
          .maybeSingle();
      if (visit == null) return ids;

      final rows = await _client
          .from('form_submissions')
          .select('form_template_id')
          .eq('visit_id', visit['id'] as String);

      ids.addAll((rows as List)
          .map((r) => (r as Map<String, dynamic>)['form_template_id'] as String));
      return ids;
    } catch (_) {
      return ids;
    }
  }

  /// Template ids for this visit whose submissions are queued but not synced.
  Future<Set<String>> pendingTemplateIds(String visitClientId) async {
    final pending = await _db.pendingEntries(limit: 1000);
    final ids = <String>{};
    for (final entry in pending) {
      if (entry.entityType != OutboxType.formSubmission) continue;
      final data = jsonDecode(entry.payload) as Map<String, dynamic>;
      if (data['visit_client_generated_id'] == visitClientId) {
        ids.add(data['form_template_id'] as String);
      }
    }
    return ids;
  }

  /// Queues the whole form — submission, answers, and any photos — as one
  /// outbox entry so it can never land half-written.
  Future<void> submitForm({
    required String orgId,
    required String repId,
    required String visitClientGeneratedId,
    required FormTemplate template,
    required Map<String, FormAnswer> answers,
  }) async {
    Position? photoPosition;
    final hasPhotos = template.fields
        .any((f) => f.fieldType == 'photo' && answers[f.id]?.photo != null);
    if (hasPhotos) {
      try {
        photoPosition = await LocationService.getCurrentPosition();
      } catch (_) {
        photoPosition = null;
      }
    }

    final responses = <Map<String, dynamic>>[];

    for (final field in template.fields) {
      final answer = answers[field.id];
      if (answer == null || answer.isEmpty) continue;

      final row = <String, dynamic>{
        'form_field_id': field.id,
        'value_text':
            field.fieldType == 'date' ? answer.date?.toIso8601String() : answer.text,
        'value_number': answer.number,
        'value_boolean': answer.boolean,
      };

      if (field.fieldType == 'photo' && answer.photo != null) {
        // Normally the photo was already copied out of the OS temp dir the
        // moment it was taken, so that a kill between capture and submit
        // cannot lose it. Copying again here would file the same photo under
        // a second id; the fallback only covers an answer that never went
        // through capture.
        final photoClientId = answer.photoClientId ?? _uuid.v4();
        final saved = answer.photoClientId != null
            ? answer.photo!
            : await _persistPhoto(answer.photo!, photoClientId);
        row['local_photo_path'] = saved.path;
        row['photo_client_generated_id'] = photoClientId;
        row['photo_lat'] = photoPosition?.latitude;
        row['photo_lng'] = photoPosition?.longitude;
        row['photo_taken_at'] = DateTime.now().toUtc().toIso8601String();
      }

      responses.add(row);
    }

    final submissionClientId = _uuid.v4();
    await _db.enqueue(
      entityType: OutboxType.formSubmission,
      clientGeneratedId: submissionClientId,
      payload: jsonEncode({
        'org_id': orgId,
        'rep_id': repId,
        'visit_id': visitClientGeneratedId,
        'visit_client_generated_id': visitClientGeneratedId,
        'form_template_id': template.id,
        'submitted_at': DateTime.now().toUtc().toIso8601String(),
        'client_generated_id': submissionClientId,
        'responses': responses,
      }),
    );

    unawaited(_sync.sync());
  }

  /// Copies a just-taken photo somewhere the OS will not reclaim, and returns
  /// it with the id the submission will use.
  ///
  /// This runs at capture time rather than at submit time on purpose. The gap
  /// between the two is where the app is most likely to be killed — the camera
  /// has just been open — and `image_picker` hands back a file in a cache
  /// directory that Android is free to empty.
  Future<({File file, String clientId})> persistCapturedPhoto(
      File source) async {
    final clientId = _uuid.v4();
    final file = await _persistPhoto(source, clientId);
    return (file: file, clientId: clientId);
  }

  Future<File> _persistPhoto(File source, String clientId) async {
    final dir = await getApplicationDocumentsDirectory();
    final photoDir = Directory(p.join(dir.path, 'pending_photos'));
    if (!photoDir.existsSync()) photoDir.createSync(recursive: true);
    return source.copy(p.join(photoDir.path, '$clientId.jpg'));
  }
}
