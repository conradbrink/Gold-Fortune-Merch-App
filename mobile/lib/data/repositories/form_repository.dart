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

  Future<List<FormTemplate>> fetchActiveTemplates() async {
    final rows = await _client
        .from('form_templates')
        .select(
            'id, name, description, form_fields(id, label, field_type, options, required, sort_order)')
        .eq('active', true)
        .order('name');

    return (rows as List)
        .map((r) => FormTemplate.fromMap(r as Map<String, dynamic>))
        .toList();
  }

  Future<Set<String>> fetchSubmittedTemplateIds(String visitClientId) async {
    try {
      final visit = await _client
          .from('visits')
          .select('id')
          .eq('client_generated_id', visitClientId)
          .maybeSingle();
      if (visit == null) return {};

      final rows = await _client
          .from('form_submissions')
          .select('form_template_id')
          .eq('visit_id', visit['id'] as String);

      return (rows as List)
          .map((r) => (r as Map<String, dynamic>)['form_template_id'] as String)
          .toSet();
    } catch (_) {
      return {};
    }
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
        // Copy out of the OS temp dir — that can be reclaimed before the
        // queue drains, which would lose the evidence.
        final photoClientId = _uuid.v4();
        final saved = await _persistPhoto(answer.photo!, photoClientId);
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

  Future<File> _persistPhoto(File source, String clientId) async {
    final dir = await getApplicationDocumentsDirectory();
    final photoDir = Directory(p.join(dir.path, 'pending_photos'));
    if (!photoDir.existsSync()) photoDir.createSync(recursive: true);
    return source.copy(p.join(photoDir.path, '$clientId.jpg'));
  }
}
