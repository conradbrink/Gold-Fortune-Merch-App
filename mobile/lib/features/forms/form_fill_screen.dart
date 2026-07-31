import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/local/form_draft.dart';
import '../../data/models/form_template.dart';
import '../../data/repositories/form_repository.dart';

class FormFillScreen extends ConsumerStatefulWidget {
  const FormFillScreen({
    super.key,
    required this.template,
    required this.visitClientGeneratedId,
  });

  final FormTemplate template;
  final String visitClientGeneratedId;

  @override
  ConsumerState<FormFillScreen> createState() => _FormFillScreenState();
}

class _FormFillScreenState extends ConsumerState<FormFillScreen> {
  final _answers = <String, FormAnswer>{};
  final _picker = ImagePicker();
  bool _submitting = false;

  /// Answers are not on screen until the saved draft has been read back, so
  /// that a restored value is the field's initial value rather than something
  /// written over what the rep has already started typing.
  bool _restoring = true;
  bool _restoredSomething = false;

  /// Held rather than read from `ref` on demand, because the last write
  /// happens in `dispose`, by which point reading a provider is no longer
  /// allowed.
  late final FormDraftStore _drafts;

  @override
  void initState() {
    super.initState();
    _drafts = FormDraftStore(ref.read(appDatabaseProvider));
    _restore();
  }

  /// Puts back whatever survived the app being killed.
  ///
  /// Two separate things can have been lost: the answers, which we wrote
  /// ourselves, and the photo, which Android took while our process was dead
  /// and which `image_picker` holds until it is asked for.
  Future<void> _restore() async {
    final draft = await _drafts.load(
      visitClientGeneratedId: widget.visitClientGeneratedId,
      templateId: widget.template.id,
    );

    if (draft != null) _answers.addAll(draft.answers);

    // Only Android loses the process this way, and only a field that had the
    // camera open can own the result.
    final pendingFieldId = draft?.pendingPhotoFieldId;
    if (pendingFieldId != null) {
      await _recoverLostPhoto(pendingFieldId);
    }

    if (!mounted) return;
    setState(() {
      _restoring = false;
      _restoredSomething = _answers.values.any((a) => !a.isEmpty);
    });

    if (_restoredSomething) {
      await _saveDraft(pendingPhotoFieldId: null);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(
          content: Text('Your answers were saved — carry on where you left off.'),
          backgroundColor: AppColors.success,
        ));
    }
  }

  Future<void> _recoverLostPhoto(String fieldId) async {
    try {
      final lost = await _picker.retrieveLostData();
      if (lost.isEmpty || lost.file == null) return;
      final saved = await ref
          .read(formRepositoryProvider)
          .persistCapturedPhoto(File(lost.file!.path));
      _answerFor(fieldId)
        ..photo = saved.file
        ..photoClientId = saved.clientId;
    } catch (_) {
      // Recovery is a bonus, never a blocker: if the photo cannot be got back
      // the rep simply retakes it, with the rest of the form still intact.
    }
  }

  FormAnswer _answerFor(String fieldId) =>
      _answers.putIfAbsent(fieldId, () => FormAnswer());

  /// Writes the draft out. Callers that are about to hand control to another
  /// app must await this — once the camera is open there may be no more of our
  /// code left to run.
  Future<void> _saveDraft({required String? pendingPhotoFieldId}) {
    return _drafts.save(
      visitClientGeneratedId: widget.visitClientGeneratedId,
      templateId: widget.template.id,
      draft: FormDraft(
        answers: _answers,
        pendingPhotoFieldId: pendingPhotoFieldId,
      ),
    );
  }

  /// Records an answer and persists it. Every input goes through here or
  /// [_typed], so there is no path that changes an answer without it reaching
  /// disk.
  void _setAnswer(void Function() change) {
    setState(change);
    unawaited(_saveDraft(pendingPhotoFieldId: null));
  }

  /// Typing, which needs no rebuild — the field already shows what was typed —
  /// and should not write to sqlite once per keystroke on a slow phone.
  void _typed(void Function() change) {
    change();
    _saveTimer?.cancel();
    _saveTimer = Timer(
      const Duration(milliseconds: 400),
      () => unawaited(_saveDraft(pendingPhotoFieldId: null)),
    );
  }

  Timer? _saveTimer;

  @override
  void dispose() {
    // A pending debounce would otherwise drop the last few characters typed
    // before the rep backed out of the form.
    if (_saveTimer?.isActive ?? false) {
      _saveTimer!.cancel();
      unawaited(_saveDraft(pendingPhotoFieldId: null));
    }
    super.dispose();
  }

  String? _validate() {
    for (final field in widget.template.fields) {
      if (!field.required) continue;
      final a = _answers[field.id];
      if (a == null || a.isEmpty) return 'Please answer "${field.label}".';
    }
    return null;
  }

  /// Camera only — deliberately no gallery option. Reps must photograph the
  /// shelf in front of them, so a stored or forwarded image can't be passed
  /// off as fresh evidence.
  Future<void> _takePhoto(FormFieldDef field) async {
    // Written, and awaited, before the camera opens. Android may kill this
    // process the moment the camera activity comes up, and this record is the
    // only thing that will say which field the recovered photo belongs to.
    await _saveDraft(pendingPhotoFieldId: field.id);

    final picked = await _picker.pickImage(
      source: ImageSource.camera,
      preferredCameraDevice: CameraDevice.rear,
      imageQuality: 75,
      maxWidth: 1600,
    );

    if (picked == null) {
      // Cancelled, so nothing is pending any more. Left set, a later restart
      // would attach an unrelated recovered photo to this field.
      await _saveDraft(pendingPhotoFieldId: null);
      return;
    }

    // Copied out of the OS cache straight away rather than at submit time:
    // the rep still has a dozen fields to fill in, and Android is free to
    // empty that directory in the meantime.
    final saved = await ref
        .read(formRepositoryProvider)
        .persistCapturedPhoto(File(picked.path));

    if (!mounted) return;
    setState(() {
      _answerFor(field.id)
        ..photo = saved.file
        ..photoClientId = saved.clientId;
    });
    await _saveDraft(pendingPhotoFieldId: null);
  }

  Future<void> _submit() async {
    final error = _validate();
    if (error != null) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(error)));
      return;
    }

    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      // Offline with no cached profile — say so rather than doing nothing.
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(
          content: Text(
            "Your profile hasn't loaded yet. Connect to the internet once "
            'and try again.',
          ),
        ));
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref.read(formRepositoryProvider).submitForm(
            orgId: profile.orgId,
            repId: profile.id,
            visitClientGeneratedId: widget.visitClientGeneratedId,
            template: widget.template,
            answers: _answers,
          );
      // Only once the submission is safely on the queue. Clearing it earlier
      // would turn a failed enqueue into a lost form.
      await _drafts.clear(
        visitClientGeneratedId: widget.visitClientGeneratedId,
        templateId: widget.template.id,
      );
      if (!mounted) return;
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('Could not submit: $e')));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_restoring) {
      return Scaffold(
        appBar: AppBar(title: Text(widget.template.name)),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text(widget.template.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (widget.template.description != null) ...[
            Text(
              widget.template.description!,
              style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 16),
          ],
          ...widget.template.fields.map(_buildField),
          const SizedBox(height: 8),
          SizedBox(
            height: 52,
            child: ElevatedButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : const Text('Submit form', style: TextStyle(fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildField(FormFieldDef field) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  field.label,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 14.5,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              if (field.required)
                const Text('*', style: TextStyle(color: AppColors.danger)),
            ],
          ),
          const SizedBox(height: 8),
          _buildInput(field),
        ],
      ),
    );
  }

  Widget _buildInput(FormFieldDef field) {
    final answer = _answerFor(field.id);

    switch (field.fieldType) {
      case 'number':
        return TextFormField(
          key: ValueKey('number:${field.id}'),
          initialValue: answer.number?.toString(),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(hintText: 'Enter a number'),
          onChanged: (v) => _typed(() => answer.number = num.tryParse(v)),
        );

      case 'boolean':
        return Row(
          children: [
            Expanded(
              child: _ChoiceChip(
                label: 'Yes',
                selected: answer.boolean == true,
                onTap: () => _setAnswer(() => answer.boolean = true),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _ChoiceChip(
                label: 'No',
                selected: answer.boolean == false,
                onTap: () => _setAnswer(() => answer.boolean = false),
              ),
            ),
          ],
        );

      case 'multiple_choice':
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: field.options
              .map((opt) => _ChoiceChip(
                    label: opt,
                    selected: answer.text == opt,
                    onTap: () => _setAnswer(() => answer.text = opt),
                  ))
              .toList(),
        );

      case 'date':
        return OutlinedButton.icon(
          onPressed: () async {
            final now = DateTime.now();
            final picked = await showDatePicker(
              context: context,
              initialDate: answer.date ?? now,
              firstDate: DateTime(now.year - 2),
              lastDate: DateTime(now.year + 2),
            );
            if (picked != null) _setAnswer(() => answer.date = picked);
          },
          icon: const Icon(Icons.calendar_today_outlined, size: 18),
          label: Text(
            answer.date == null
                ? 'Pick a date'
                : DateFormat.yMMMd().format(answer.date!),
          ),
        );

      case 'photo':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (answer.photo != null) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.file(
                  answer.photo!,
                  height: 170,
                  width: double.infinity,
                  fit: BoxFit.cover,
                ),
              ),
              const SizedBox(height: 8),
            ],
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => _takePhoto(field),
                icon: const Icon(Icons.photo_camera_outlined, size: 18),
                label: Text(
                  answer.photo == null ? 'Take photo' : 'Retake photo',
                ),
              ),
            ),
            const SizedBox(height: 6),
            const Row(
              children: [
                Icon(Icons.lock_outline, size: 13, color: AppColors.textMuted),
                SizedBox(width: 5),
                Expanded(
                  child: Text(
                    'Photos must be taken now — gallery uploads are disabled.',
                    style: TextStyle(
                        fontSize: 11.5, color: AppColors.textMuted),
                  ),
                ),
              ],
            ),
          ],
        );

      case 'text':
      default:
        return TextFormField(
          key: ValueKey('text:${field.id}'),
          initialValue: answer.text,
          maxLines: 3,
          minLines: 1,
          decoration: const InputDecoration(hintText: 'Type your answer'),
          onChanged: (v) => _typed(() => answer.text = v.isEmpty ? null : v),
        );
    }
  }
}

class _ChoiceChip extends StatelessWidget {
  const _ChoiceChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.navy : Colors.white,
          border: Border.all(
            color: selected ? AppColors.navy : AppColors.border,
          ),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: selected ? Colors.white : AppColors.textPrimary,
            fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
