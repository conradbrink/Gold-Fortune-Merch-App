import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/delivery.dart';

/// The driver records the drop: who received it, and a photo of the signed
/// delivery note as the proof (owner, 27 Oct 2026: a photo, no on-screen
/// signature; full deliveries only).
///
/// Returns true when the drop was queued.
Future<bool?> showDeliveryConfirmSheet(BuildContext context, DeliveryDetail detail) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
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
  File? _photo;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

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
    final photo = _photo;
    if (profile == null || photo == null) {
      setState(() => _error = 'Could not read your profile. Try again in a moment.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(deliveryRepositoryProvider).confirmDelivery(
            orgId: profile.orgId,
            repId: profile.id,
            delivery: widget.detail,
            receivedBy: _name.text,
            photo: photo,
          );
      ref.invalidate(pendingDeliveryConfirmsProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.detail.delivery;
    final ready = _photo != null && _name.text.trim().isNotEmpty && !_saving;
    final units = '${d.units} ${d.units == 1 ? 'unit' : 'units'}';

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Record the delivery',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
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
            const SizedBox(height: 14),
            if (_photo == null)
              OutlinedButton.icon(
                onPressed: _saving ? null : _takePhoto,
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                icon: const Icon(Icons.photo_camera_outlined),
                label: const Text('Take a photo of the signed delivery note'),
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
