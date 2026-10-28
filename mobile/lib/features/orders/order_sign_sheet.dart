import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/company_config.dart';
import '../../core/theme.dart';
import '../../shared/widgets/signature_pad.dart';

/// The manager's signature and the name beside it.
typedef OrderSignature = ({Uint8List png, String name});

/// The last step of taking an order: the shop's manager signs for it on the
/// rep's phone. Every order needs one (the owner's rule, 27 Oct 2026), so
/// "Save order" opens this rather than saving.
///
/// Returns null when the rep closes it; the order stays as a draft.
Future<OrderSignature?> showOrderSignSheet(
  BuildContext context, {
  required int lineCount,
  required String storeName,
  String? signerName,
}) {
  return showModalBottomSheet<OrderSignature>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    // A signature drawn downwards would otherwise drag the sheet closed.
    enableDrag: false,
    showDragHandle: false,
    builder: (_) => _OrderSignSheet(
      lineCount: lineCount,
      storeName: storeName,
      signerName: signerName,
    ),
  );
}

class _OrderSignSheet extends ConsumerStatefulWidget {
  const _OrderSignSheet({
    required this.lineCount,
    required this.storeName,
    required this.signerName,
  });

  final int lineCount;
  final String storeName;
  final String? signerName;

  @override
  ConsumerState<_OrderSignSheet> createState() => _OrderSignSheetState();
}

class _OrderSignSheetState extends ConsumerState<_OrderSignSheet> {
  final _pad = SignaturePadController();
  late final _name = TextEditingController(text: widget.signerName ?? '');
  bool _busy = false;

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

  bool get _ready => _pad.isSigned && _name.text.trim().isNotEmpty && !_busy;

  Future<void> _done() async {
    setState(() => _busy = true);
    Uint8List? png;
    try {
      png = await _pad.toPng();
    } catch (_) {
      // Drawing the picture failed (memory on a small handset). The sheet
      // must not stay stuck on "Saving…": the rep can try again.
      png = null;
    }
    if (!mounted) return;
    if (png == null) {
      setState(() => _busy = false);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(content: Text('The signature could not be saved. Try again.')),
      );
      return;
    }
    Navigator.of(context).pop((png: png, name: _name.text.trim()));
  }

  @override
  Widget build(BuildContext context) {
    final site = ref.watch(termsProvider).site.oneLower;
    final lines = '${widget.lineCount} line${widget.lineCount == 1 ? '' : 's'}';
    return Padding(
      // Above the keyboard while the name is typed.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Manager signs for the order',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                ),
                IconButton(
                  onPressed: _busy ? null : () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                  tooltip: 'Back to the order',
                ),
              ],
            ),
            Text(
              '${widget.storeName} · $lines. Hand the phone to the $site '
              'manager to sign.',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _name,
              onChanged: (_) => setState(() {}),
              textCapitalization: TextCapitalization.words,
              maxLength: 120,
              decoration: const InputDecoration(
                labelText: 'Name of the person signing',
                isDense: true,
                counterText: '',
              ),
            ),
            const SizedBox(height: 12),
            SignaturePad(controller: _pad),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: _pad.strokes.isEmpty || _busy ? null : _pad.clear,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Clear and sign again'),
              ),
            ),
            const SizedBox(height: 4),
            FilledButton(
              onPressed: _ready ? _done : null,
              child: Text(_busy ? 'Saving…' : 'Signed. Save the order'),
            ),
          ],
        ),
      ),
    );
  }
}
