import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
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

  FormAnswer _answerFor(String fieldId) =>
      _answers.putIfAbsent(fieldId, () => FormAnswer());

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
    final picked = await _picker.pickImage(
      source: ImageSource.camera,
      preferredCameraDevice: CameraDevice.rear,
      imageQuality: 75,
      maxWidth: 1600,
    );
    if (picked == null) return;
    setState(() => _answerFor(field.id).photo = File(picked.path));
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
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(hintText: 'Enter a number'),
          onChanged: (v) => answer.number = num.tryParse(v),
        );

      case 'boolean':
        return Row(
          children: [
            Expanded(
              child: _ChoiceChip(
                label: 'Yes',
                selected: answer.boolean == true,
                onTap: () => setState(() => answer.boolean = true),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _ChoiceChip(
                label: 'No',
                selected: answer.boolean == false,
                onTap: () => setState(() => answer.boolean = false),
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
                    onTap: () => setState(() => answer.text = opt),
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
            if (picked != null) setState(() => answer.date = picked);
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
          maxLines: 3,
          minLines: 1,
          decoration: const InputDecoration(hintText: 'Type your answer'),
          onChanged: (v) => answer.text = v.isEmpty ? null : v,
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
