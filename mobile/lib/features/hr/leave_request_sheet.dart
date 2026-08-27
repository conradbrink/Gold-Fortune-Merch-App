import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/hr.dart';

/// Apply for leave, with the note attached.
///
/// The note is a photograph, not a file browse. A rep has a paper sick note in
/// their hand and a camera in the same device; asking them to scan it, mail it
/// to themselves and find it in Downloads is how the requirement quietly stops
/// being met.
///
/// The day count comes from `hr_working_days()` rather than being counted here.
/// Weekends are configurable per organisation and public holidays are a table,
/// so an app that counted them itself would be right until somebody changed
/// either — and wrong silently, on the number a balance is decremented by.
class LeaveRequestSheet extends ConsumerStatefulWidget {
  const LeaveRequestSheet({
    super.key,
    required this.orgId,
    required this.employeeId,
  });

  final String orgId;
  final String employeeId;

  @override
  ConsumerState<LeaveRequestSheet> createState() => _LeaveRequestSheetState();
}

class _LeaveRequestSheetState extends ConsumerState<LeaveRequestSheet> {
  final _picker = ImagePicker();
  final _reason = TextEditingController();

  LeaveType? _type;
  DateTime? _from;
  DateTime? _to;
  File? _document;
  String? _documentName;

  /// Null until the server has been asked. Never guessed at locally.
  double? _days;
  bool _countingDays = false;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pickDates() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      // A year either side. Leave taken last month still gets filed, and a
      // booking for next December is a normal thing to ask for.
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 1, 12, 31),
      initialDateRange: _from != null && _to != null
          ? DateTimeRange(start: _from!, end: _to!)
          : null,
    );
    if (picked == null) return;
    setState(() {
      _from = picked.start;
      _to = picked.end;
      _days = null;
    });
    await _countDays();
  }

  Future<void> _countDays() async {
    final from = _from;
    final to = _to;
    if (from == null || to == null) return;
    setState(() => _countingDays = true);
    try {
      final days = await ref
          .read(hrRepositoryProvider)
          .workingDays(widget.orgId, from, to);
      if (mounted) setState(() => _days = days);
    } catch (_) {
      // Left null rather than filled with a guess. The form refuses to submit
      // without it, which is the right refusal: a request whose day count the
      // server has not agreed to is a request nobody can decide fairly.
      if (mounted) setState(() => _days = null);
    } finally {
      if (mounted) setState(() => _countingDays = false);
    }
  }

  Future<void> _attach(ImageSource source) async {
    try {
      final shot = await _picker.pickImage(
        source: source,
        // Enough to read a doctor's handwriting, small enough to send on a rural
        // connection. The same trade the visit photos make.
        imageQuality: 70,
        maxWidth: 1600,
      );
      if (shot == null) return;
      if (!mounted) return;
      setState(() {
        _document = File(shot.path);
        _documentName = shot.name;
        _error = null;
      });
    } catch (e) {
      // The picker throws rather than returning null when the camera permission
      // is refused or no camera exists. Unhandled, the button did nothing at
      // all — and on the one form that will not submit without a photograph,
      // "nothing happened" is the worst possible answer.
      if (!mounted) return;
      setState(() => _error =
          'The camera or gallery could not be opened. Check the app\'s '
          'permissions and try again.\n$e');
    }
  }

  Future<void> _submit() async {
    final type = _type;
    final from = _from;
    final to = _to;
    final days = _days;

    if (type == null || from == null || to == null) {
      setState(() => _error = 'Choose the type of leave and the dates.');
      return;
    }
    if (days == null) {
      setState(() => _error =
          'The working days could not be counted. Check your signal and try the dates again.');
      return;
    }
    if (days <= 0) {
      setState(() => _error =
          'Those dates cover no working days. Check the dates, or speak to your manager.');
      return;
    }
    if (type.requiresDocument && _document == null) {
      setState(() => _error =
          '${type.name} needs a note attached. Photograph it before sending.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final repo = ref.read(hrRepositoryProvider);
      // Uploaded first: the request row carries the path, and the database
      // refuses the row without it when the type requires one.
      String? path;
      if (_document != null) {
        path = await repo.uploadDocument(
          orgId: widget.orgId,
          employeeId: widget.employeeId,
          file: _document!,
          fileName: _documentName ?? 'note.jpg',
        );
      }
      await repo.fileLeave(
        orgId: widget.orgId,
        employeeId: widget.employeeId,
        leaveTypeId: type.id,
        from: from,
        to: to,
        days: days,
        reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
        documentPath: path,
      );
      ref.invalidate(myLeaveRequestsProvider);
      ref.invalidate(myLeaveBalancesProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Your request was not sent.\n$e');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final typesAsync = ref.watch(leaveTypesProvider);
    final fmt = DateFormat('d MMM yyyy');

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 16,
        // Above the keyboard, which otherwise covers the reason field and the
        // Send button together.
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Apply for leave',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            typesAsync.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text(
                'The leave types could not be loaded. You need signal to apply.',
                style: const TextStyle(color: AppColors.danger),
              ),
              data: (types) => DropdownButtonFormField<LeaveType>(
                initialValue: _type,
                decoration: const InputDecoration(labelText: 'Type of leave'),
                items: [
                  for (final t in types)
                    DropdownMenuItem(
                      value: t,
                      child: Text(t.isPaid ? t.name : '${t.name} (unpaid)'),
                    ),
                ],
                onChanged: (t) => setState(() {
                  _type = t;
                  _error = null;
                }),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _pickDates,
              icon: const Icon(Icons.date_range_outlined),
              label: Text(
                _from == null || _to == null
                    ? 'Choose the dates'
                    : '${fmt.format(_from!)} — ${fmt.format(_to!)}',
              ),
            ),
            if (_countingDays)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('Counting working days…',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
              )
            else if (_days != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  // Said out loud, because it is the number that comes off the
                  // balance and it is not the number of days on the calendar.
                  '${formatDays(_days!)} working '
                  '${_days == 1 ? 'day' : 'days'}, weekends and public '
                  'holidays excluded.',
                  style: const TextStyle(
                      color: AppColors.textMuted, fontSize: 12),
                ),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _reason,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Reason (optional)',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 12),
            if (_type?.requiresDocument ?? false)
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.warning.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${_type!.name} needs a note. Photograph it — it goes straight '
                  'into your file and only HR can read it.',
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _attach(ImageSource.camera),
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: const Text('Photograph'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _attach(ImageSource.gallery),
                    icon: const Icon(Icons.image_outlined),
                    label: const Text('From gallery'),
                  ),
                ),
              ],
            ),
            if (_document != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle,
                        size: 18, color: AppColors.success),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _documentName ?? 'Note attached',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    TextButton(
                      onPressed: () => setState(() {
                        _document = null;
                        _documentName = null;
                      }),
                      child: const Text('Remove'),
                    ),
                  ],
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_error!,
                    style: const TextStyle(color: AppColors.danger)),
              ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _submit,
              child: Text(_saving ? 'Sending…' : 'Send the request'),
            ),
          ],
        ),
      ),
    );
  }
}
