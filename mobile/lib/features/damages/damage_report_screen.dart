import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/local/app_database.dart';
import '../../data/models/catalogue_product.dart';
import '../../data/repositories/form_repository.dart';
import '../../data/repositories/order_repository.dart';

/// What a rep picks for "What's wrong?", in the words they would say.
const damageProblems = <String>[
  'Broken',
  'Leaking',
  'Box or packaging damaged',
  'Not working',
  'Expired',
];

/// Reports damaged stock of ours found at the store (owner, 15 Oct 2026: "a
/// box for if they have any damages and then ask for what is damaged with a
/// photo").
///
/// One item per report: which product (or, for something not in the list,
/// what it is), how many single items, what is wrong, and a photo. The photo is
/// asked for, not required: a camera that will not open must not stop the rep
/// telling the office.
class DamageReportScreen extends ConsumerStatefulWidget {
  const DamageReportScreen({
    super.key,
    required this.visitClientId,
    required this.storeId,
    required this.storeName,
    required this.visitKey,
  });

  final String visitClientId;
  final String storeId;
  final String storeName;
  final String visitKey;

  @override
  ConsumerState<DamageReportScreen> createState() => _DamageReportScreenState();
}

/// The "Something not in the list" choice.
const _otherItem = '__other__';

/// The most one report says. The database allows more (100000); this keeps a
/// slip of the thumb on the + button from becoming a report nobody believes.
const _maxQty = 9999;

/// A photo that came back to a damage screen the router had already replaced
/// (a sign-in blip while the camera was open), on its way to the screen that
/// replaced it.
final _photoHandOver = StreamController<({String draftKey, ({File file, String clientId}) photo})>.broadcast();

class _DamageReportScreenState extends ConsumerState<DamageReportScreen> {
  final _picker = ImagePicker();
  final _item = TextEditingController();
  final _note = TextEditingController();
  List<CatalogueProduct> _catalogue = const [];

  /// A product id, [_otherItem], or null before one is chosen.
  String? _what;
  int _qty = 1;
  String? _problem;
  ({File file, String clientId})? _photo;
  bool _saving = false;
  String? _error;

  /// The kept draft has been read and put back; until then the form is not
  /// shown, so nothing the rep does can overwrite it unread.
  bool _restored = false;

  /// The phone had no products and is fetching them.
  bool _loadingProducts = false;

  late final String _draftKey;
  late final StreamSubscription<void> _handOvers;

  // Held from the start, so nothing after an await reaches for `ref`: the
  // screen can be gone by then (a sign-in blip sends the router to /login
  // and brings the rep back here afterwards).
  late final AppDatabase _db;
  late final OrderRepository _orders;
  late final FormRepository _forms;
  late final ProviderContainer _container;

  @override
  void initState() {
    super.initState();
    _db = ref.read(appDatabaseProvider);
    _orders = ref.read(orderRepositoryProvider);
    _forms = ref.read(formRepositoryProvider);
    _container = ProviderScope.containerOf(context, listen: false);
    _draftKey = OrderRepository.damageDraftKey(widget.visitClientId);
    _handOvers = _photoHandOver.stream.listen((e) {
      if (e.draftKey != _draftKey || !mounted) return;
      setState(() => _photo = e.photo);
      unawaited(_saveDraft());
    });
    _restore();
  }

  @override
  void dispose() {
    // Nothing is thrown away here. The draft is what brings the report back
    // when the router rebuilt this screen. Save and "Start again" clear it,
    // and so does checking out, after which nobody can come back to it.
    _handOvers.cancel();
    _item.dispose();
    _note.dispose();
    super.dispose();
  }

  /// Puts back what was being reported: what the rep had filled in, which is
  /// saved on every change, and a photo Android took while our process was
  /// dead, which `image_picker` holds until asked (the form screen does the
  /// same, for the same 1 GB handsets). All of it from the phone, before the
  /// form is shown; then the products, from the network when the phone has
  /// none yet, while the rep carries on.
  Future<void> _restore() async {
    final draft = await _readDraft();
    ({File file, String clientId})? photo;
    final path = draft?['photo_path'] as String?;
    final photoId = draft?['photo_client_id'] as String?;
    if (path != null && photoId != null && File(path).existsSync()) {
      photo = (file: File(path), clientId: photoId);
    }
    if (draft?['camera_open'] == true) {
      try {
        final lost = await _picker.retrieveLostData();
        if (!lost.isEmpty && lost.file != null) {
          photo = await _forms.persistCapturedPhoto(File(lost.file!.path));
        }
      } catch (_) {
        // A bonus, never a blocker: the rep retakes it.
      }
    }
    final cached = await _orders.cachedCatalogue();
    if (!mounted) return;
    setState(() {
      _restored = true;
      _catalogue = cached;
      _loadingProducts = cached.isEmpty;
      if (draft != null) {
        _what = draft['what'] as String?;
        _item.text = (draft['item'] as String?) ?? '';
        _qty = ((draft['qty'] as num?)?.toInt() ?? 1).clamp(1, _maxQty);
        _problem = draft['problem'] as String?;
        _note.text = (draft['note'] as String?) ?? '';
        // A photo handed over while the draft was being read is the newer one.
        _photo ??= photo;
      }
    });
    if (draft != null) {
      await _saveDraft();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Your report was kept. Carry on where you left off, or start again.')),
        );
      }
    }
    if (cached.isEmpty) {
      var fetched = const <CatalogueProduct>[];
      try {
        fetched = await _orders.fetchCatalogue();
      } catch (_) {
        // No signal: "Something not in the list" still works.
      }
      if (!mounted) return;
      setState(() {
        _catalogue = fetched;
        _loadingProducts = false;
      });
    }
  }

  /// The draft for this visit, or null; one older than
  /// [OrderRepository.damageDraftMaxAge] is dropped, with its photo.
  Future<Map<String, dynamic>?> _readDraft() async {
    final raw = await _db.getValue(_draftKey);
    if (raw == null) return null;
    Map<String, dynamic> draft;
    try {
      draft = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    } catch (_) {
      await _db.deleteValue(_draftKey);
      return null;
    }
    final saved = DateTime.tryParse('${draft['saved_at']}');
    if (saved == null || DateTime.now().difference(saved) > OrderRepository.damageDraftMaxAge) {
      await _discard(draft['photo_path'] as String?);
      return null;
    }
    return draft;
  }

  /// Saved on every change, and awaited before the camera opens: Android may
  /// kill this process the moment the camera comes up. Not before the kept
  /// draft is read, which it would overwrite.
  Future<void> _saveDraft({bool cameraOpen = false}) async {
    if (!_restored) return;
    await _db.setValue(
      _draftKey,
      jsonEncode({
        'what': _what,
        'item': _item.text,
        'qty': _qty,
        'problem': _problem,
        'note': _note.text,
        'photo_path': _photo?.file.path,
        'photo_client_id': _photo?.clientId,
        'camera_open': cameraOpen,
        'saved_at': DateTime.now().toIso8601String(),
      }),
    );
  }

  /// A change the rep made: shown, and kept.
  void _change(VoidCallback update) {
    setState(update);
    unawaited(_saveDraft());
  }

  /// Clears the draft and deletes its photo, when nothing else refers to it.
  Future<void> _discard(String? photoPath) async {
    await _db.deleteValue(_draftKey);
    if (photoPath == null) return;
    try {
      await File(photoPath).delete();
    } catch (_) {
      // A leftover file costs space, not the report.
    }
  }

  Future<void> _startAgain() async {
    final photo = _photo;
    setState(() {
      _what = null;
      _item.clear();
      _qty = 1;
      _problem = null;
      _note.clear();
      _photo = null;
      _error = null;
    });
    await _discard(photo?.file.path);
  }

  CatalogueProduct? get _product {
    for (final p in _catalogue) {
      if (p.id == _what) return p;
    }
    return null;
  }

  bool get _started =>
      _what != null || _problem != null || _photo != null || _note.text.isNotEmpty || _qty != 1;

  Future<void> _pickWhat() async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _ProductPicker(catalogue: _catalogue),
    );
    if (chosen != null && mounted) _change(() => _what = chosen);
  }

  Future<void> _takePhoto() async {
    await _saveDraft(cameraOpen: true);
    final picked = await _picker.pickImage(
      source: ImageSource.camera,
      preferredCameraDevice: CameraDevice.rear,
      imageQuality: 75,
      maxWidth: 1600,
    );
    if (picked == null) {
      // A screen that has been replaced leaves the draft to the one showing.
      if (mounted) await _saveDraft();
      return;
    }
    // Out of the OS cache at once, as a form does: Android may empty it before
    // the report is saved.
    final saved = await _forms.persistCapturedPhoto(File(picked.path));
    if (!mounted) {
      await _handOver(saved);
      return;
    }
    final previous = _photo;
    setState(() => _photo = saved);
    await _saveDraft();
    if (previous != null && previous.file.path != saved.file.path) {
      try {
        await previous.file.delete();
      } catch (_) {
        // A leftover file costs space, not the report.
      }
    }
  }

  /// The photo came back after this screen was replaced (a sign-in blip
  /// rebuilds it while the camera is open). It goes into the kept draft,
  /// keeping whatever the live screen last saved there, and to the live screen
  /// itself. With no draft left (the report was saved, or started again,
  /// meanwhile) nothing would point at it, so it is deleted.
  Future<void> _handOver(({File file, String clientId}) photo) async {
    Map<String, dynamic>? draft;
    try {
      final raw = await _db.getValue(_draftKey);
      if (raw != null) draft = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    } catch (_) {
      // Unreadable: treated as gone.
    }
    if (draft == null) {
      try {
        await photo.file.delete();
      } catch (_) {
        // A leftover file costs space, not the report.
      }
      return;
    }
    final previous = draft['photo_path'];
    await _db.setValue(
      _draftKey,
      jsonEncode({
        ...draft,
        'photo_path': photo.file.path,
        'photo_client_id': photo.clientId,
        'camera_open': false,
        'saved_at': DateTime.now().toIso8601String(),
      }),
    );
    _photoHandOver.add((draftKey: _draftKey, photo: photo));
    if (previous is String && previous != photo.file.path) {
      try {
        await File(previous).delete();
      } catch (_) {
        // A leftover file costs space, not the report.
      }
    }
  }

  Future<void> _save() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      setState(() => _error = "Your profile hasn't loaded yet. Connect to the internet once and try again.");
      return;
    }
    final product = _product;
    final label = product?.name ?? _item.text.trim();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _orders.reportDamage(
        orgId: profile.orgId,
        repId: profile.id,
        storeId: widget.storeId,
        visitClientGeneratedId: widget.visitClientId,
        productId: product?.id,
        item: product == null ? _item.text : null,
        label: label,
        qty: _qty,
        problem: [_problem, _note.text.trim()].where((s) => s != null && s.isNotEmpty).join('. '),
        photo: _photo,
      );
      // The photo belongs to the queued report now; `reportDamage` cleared the
      // draft as it queued it.
      _container.invalidate(damagesOnVisitProvider(widget.visitClientId));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Damaged stock reported. It reaches the office when you have signal.')),
      );
      context.go('/visit/${widget.visitKey}');
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
    // The kept draft is read first, from the phone: a moment, never the network.
    if (!_restored) {
      return Scaffold(
        appBar: AppBar(title: const Text('Report damaged stock')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    final product = _product;
    final isOther = _what == _otherItem;
    final canSave = !_saving && (product != null || (isOther && _item.text.trim().isNotEmpty)) && _qty > 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Report damaged stock'),
        actions: [
          if (_started && !_saving)
            TextButton(
              onPressed: _startAgain,
              child: const Text('Start again', style: TextStyle(color: Colors.white)),
            ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(28),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(widget.storeName, style: Theme.of(context).textTheme.bodySmall),
            ),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null) ...[
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            const SizedBox(height: 12),
          ],
          const _Heading('What is damaged?'),
          OutlinedButton(
            onPressed: _pickWhat,
            style: OutlinedButton.styleFrom(
              alignment: Alignment.centerLeft,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    product?.name ??
                        (isOther
                            ? 'Something not in the list'
                            : _loadingProducts
                                ? 'Loading the products…'
                                : 'Choose the product'),
                    style: TextStyle(
                      color: product == null && !isOther ? AppColors.textMuted : AppColors.textPrimary,
                    ),
                  ),
                ),
                const Icon(Icons.expand_more),
              ],
            ),
          ),
          if (isOther) ...[
            const SizedBox(height: 8),
            TextField(
              controller: _item,
              maxLength: 200,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => _change(() {}),
              decoration: const InputDecoration(hintText: 'What is it? For example: display stand'),
            ),
          ],
          const SizedBox(height: 20),
          const _Heading('How many?'),
          Row(
            children: [
              IconButton.outlined(
                onPressed: _qty > 1 ? () => _change(() => _qty -= 1) : null,
                icon: const Icon(Icons.remove),
              ),
              SizedBox(
                width: 56,
                child: Text(
                  '$_qty',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
                ),
              ),
              IconButton.outlined(
                onPressed: _qty < _maxQty ? () => _change(() => _qty += 1) : null,
                icon: const Icon(Icons.add),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Single items, not shrinks.',
                  style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const _Heading("What's wrong?"),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final p in damageProblems)
                ChoiceChip(
                  label: Text(p),
                  selected: _problem == p,
                  onSelected: (on) => _change(() => _problem = on ? p : null),
                ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _note,
            maxLength: 400,
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => _change(() {}),
            decoration: const InputDecoration(hintText: 'Anything to add (optional)'),
          ),
          const SizedBox(height: 12),
          const _Heading('Photo'),
          if (_photo != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              // Decoded at the size it is shown, not the 1600 px it was taken at.
              child: Image.file(_photo!.file, height: 180, width: double.infinity, fit: BoxFit.cover, cacheWidth: 720),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _takePhoto,
              icon: const Icon(Icons.camera_alt_outlined),
              label: const Text('Retake photo'),
            ),
          ] else ...[
            OutlinedButton.icon(
              onPressed: _takePhoto,
              icon: const Icon(Icons.camera_alt_outlined),
              label: const Text('Take a photo'),
            ),
            const SizedBox(height: 4),
            const Text(
              'A photo helps the office sort it out quickly.',
              style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            height: 50,
            child: ElevatedButton(
              onPressed: canSave ? _save : null,
              child: Text(_saving ? 'Saving…' : 'Save', style: const TextStyle(fontSize: 16)),
            ),
          ),
        ],
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: AppColors.textPrimary),
      ),
    );
  }
}

/// The product list with a search, and a way out for anything not in it.
class _ProductPicker extends StatefulWidget {
  const _ProductPicker({required this.catalogue});

  final List<CatalogueProduct> catalogue;

  @override
  State<_ProductPicker> createState() => _ProductPickerState();
}

class _ProductPickerState extends State<_ProductPicker> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final term = _search.text.trim().toLowerCase();
    final shown = term.isEmpty
        ? widget.catalogue
        : widget.catalogue.where((p) => p.searchText.contains(term)).toList();
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.8,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              controller: _search,
              autofocus: false,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search product, brand or code',
              ),
            ),
          ),
          Expanded(
            child: ListView(
              children: [
                for (final p in shown)
                  ListTile(
                    title: Text(p.name),
                    onTap: () => Navigator.pop(context, p.id),
                  ),
                ListTile(
                  leading: const Icon(Icons.edit_outlined),
                  title: const Text('Something not in the list'),
                  onTap: () => Navigator.pop(context, _otherItem),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
