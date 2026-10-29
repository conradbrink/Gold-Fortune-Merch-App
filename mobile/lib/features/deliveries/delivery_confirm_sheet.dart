import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/delivery.dart';
import '../../shared/widgets/signature_pad.dart';

/// The driver records the drop: who received it, their signature on the
/// phone, and if the driver wants it, a photo of the signed delivery note.
/// The owner chose a photo on 27 Oct 2026 and on 29 Oct asked for the
/// receiver to sign on the phone instead: the signature is required, the
/// photo optional. Full deliveries only.
///
/// Returns true when the drop was queued.
Future<bool?> showDeliveryConfirmSheet(BuildContext context, DeliveryDetail detail) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    // A signature drawn downwards would otherwise drag the sheet closed.
    enableDrag: false,
    showDragHandle: false,
    builder: (_) => _DeliveryConfirmSheet(detail),
  );
}

class _DeliveryConfirmSheet extends ConsumerStatefulWidget {
  const _DeliveryConfirmSheet(this.detail);

  final DeliveryDetail detail;

  @override
  ConsumerState<_DeliveryConfirmSheet> createState() => _DeliveryConfirmSheetState();
}

class _DeliveryConfirmSheetState extends ConsumerState<_DeliveryConfirmSheet> {
  final _picker = ImagePicker();
  late final _name = TextEditingController(text: widget.detail.contactName ?? '');
  final _pad = SignaturePadController();
  File? _photo;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _pad.addListener(_changed);
  }

  @override
  void dispose() {
    _pad.dispose();
    _name.dispose();
    super.dispose();
  }

  void _changed() => setState(() {});

  Future<void> _takePhoto() async {
    final picked = await _picker.pickImage(
      source: ImageSource.camera,
      preferredCameraDevice: CameraDevice.rear,
      // Larger than a shelf photo: the names and numbers on a delivery note
      // have to stay readable.
      imageQuality: 80,
      maxWidth: 2000,
    );
    if (picked == null || !mounted) return;
    setState(() {
      _photo = File(picked.path);
      _error = null;
    });
  }

  Future<void> _confirm() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      setState(() => _error = 'Could not read your profile. Try again in a moment.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final signature = await _pad.tryPng();
      if (signature == null) {
        throw StateError('The signature could not be saved. Try again.');
      }
      await ref.read(deliveryRepositoryProvider).confirmDelivery(
            orgId: profile.orgId,
            repId: profile.id,
            delivery: widget.detail,
            receivedBy: _name.text,
            signature: signature,
            photo: _photo,
          );
      ref.invalidate(pendingDeliveryConfirmsProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e is StateError ? e.message : '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.detail.delivery;
    final ready = _pad.isSigned && _name.text.trim().isNotEmpty && !_saving;
    final units = '${d.units} ${d.units == 1 ? 'unit' : 'units'}';

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Record the delivery',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                ),
                IconButton(
                  onPressed: _saving ? null : () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                  tooltip: 'Back to the delivery',
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${d.storeName} · ${d.dispatchNumber} · $units',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
                ),
              ),
            ],
            const SizedBox(height: 14),
            TextField(
              controller: _name,
              onChanged: (_) => setState(() {}),
              textCapitalization: TextCapitalization.words,
              maxLength: 120,
              decoration: const InputDecoration(
                labelText: 'Who received it',
                isDense: true,
                counterText: '',
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Hand the phone over to sign for the delivery.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5),
            ),
            const SizedBox(height: 6),
            SignaturePad(controller: _pad),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: _pad.strokes.isEmpty || _saving ? null : _pad.clear,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Clear and sign again'),
              ),
            ),
            if (_photo == null)
              OutlinedButton.icon(
                onPressed: _saving ? null : _takePhoto,
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text('Add a photo of the delivery note (optional)'),
              )
            else ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.file(
                  _photo!,
                  height: 220,
                  fit: BoxFit.cover,
                  cacheWidth: 800,
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _saving ? null : _takePhoto,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text('Take it again'),
                ),
              ),
            ],
            const SizedBox(height: 10),
            const Text(
              'This records that everything on this delivery was taken. If '
              'some of it came back, phone the warehouse and they will record '
              'it instead.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: ready ? _confirm : null,
              child: Text(_saving ? 'Saving…' : 'Delivered'),
            ),
          ],
        ),
      ),
    );
  }
}
