import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../data/models/store_reorder.dart';

/// What the rep chose: one of [declineReasons]' keys, and a note when given.
typedef OrderDecline = ({String reason, String? note});

/// Asks why the store is not ordering today. Null when the rep skips it.
///
/// A question, never a gate (owner, 15 Oct 2026: "Prompt only"): there is
/// always a way out that records nothing, and nothing waits on the answer.
Future<OrderDecline?> showOrderDeclineSheet(
  BuildContext context, {
  required String title,
  String skipLabel = 'Cancel',
}) {
  return showModalBottomSheet<OrderDecline>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => _DeclineSheet(title: title, skipLabel: skipLabel),
  );
}

class _DeclineSheet extends StatefulWidget {
  const _DeclineSheet({required this.title, required this.skipLabel});

  final String title;
  final String skipLabel;

  @override
  State<_DeclineSheet> createState() => _DeclineSheetState();
}

class _DeclineSheetState extends State<_DeclineSheet> {
  String? _reason;
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Above the keyboard when the note is being typed.
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                widget.title,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Your manager sees this, so they know what is holding orders back.',
                style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
              ),
              const SizedBox(height: 8),
              RadioGroup<String>(
                groupValue: _reason,
                onChanged: (v) => setState(() => _reason = v),
                child: Column(
                  children: [
                    for (final e in declineReasons.entries)
                      RadioListTile<String>(
                        value: e.key,
                        title: Text(e.value),
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                      ),
                  ],
                ),
              ),
              if (_reason != null) ...[
                const SizedBox(height: 4),
                TextField(
                  controller: _note,
                  maxLength: 500,
                  maxLines: 2,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    hintText: _reason == 'other'
                        ? 'What did they say?'
                        : 'Anything to add (optional)',
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: Text(widget.skipLabel),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _reason == null
                          ? null
                          : () => Navigator.pop(
                                context,
                                (reason: _reason!, note: _note.text.trim()),
                              ),
                      child: const Text('Save'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
