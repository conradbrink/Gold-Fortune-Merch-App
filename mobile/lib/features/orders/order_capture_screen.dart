import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/local/order_draft.dart';
import '../../data/models/catalogue_product.dart';

/// Taking an order in the shop.
///
/// Every change is written to the draft on disk immediately. Android will kill
/// this app whenever something else wants the memory, and an order is the worst
/// thing in the product to lose — the shopkeeper has just read out twenty lines
/// and will not do it again patiently.
///
/// No stock figures are shown. A rep can only read their own van's balance, and
/// a warehouse number fetched at the depot this morning would be a lie by the
/// afternoon. The warehouse checks availability when it confirms, under a lock,
/// which is the only place the answer can be true.
class OrderCaptureScreen extends ConsumerStatefulWidget {
  const OrderCaptureScreen({
    super.key,
    required this.visitClientId,
    required this.storeId,
    required this.storeName,
    required this.visitKey,
  });

  final String visitClientId;
  final String storeId;
  final String storeName;

  /// Where leaving this screen goes back to. Held rather than popped, because
  /// this is a route now (`/visit/:key/order`) and not an imperative push —
  /// see the comment on the button that opens it.
  final String visitKey;

  @override
  ConsumerState<OrderCaptureScreen> createState() => _OrderCaptureScreenState();
}

class _OrderCaptureScreenState extends ConsumerState<OrderCaptureScreen> {
  final _search = TextEditingController();
  final _note = TextEditingController();
  final _contactName = TextEditingController();
  final _contactPhone = TextEditingController();
  final Map<String, int> _qty = {};

  /// When the shop wants it, as `yyyy-MM-dd`, or null for "no date given".
  ///
  /// Held as a string rather than a DateTime because that is what
  /// `orders.required_by` is and what the draft round-trips; converting at two
  /// boundaries instead of one is how a date drifts by a day.
  String? _requiredBy;

  bool _loading = true;
  bool _saving = false;
  String? _error;
  List<CatalogueProduct> _catalogue = const [];

  @override
  void initState() {
    super.initState();
    _restore();
  }

  @override
  void dispose() {
    _search.dispose();
    _note.dispose();
    _contactName.dispose();
    _contactPhone.dispose();
    super.dispose();
  }

  Future<void> _restore() async {
    final repo = ref.read(orderRepositoryProvider);
    final catalogue = await repo.cachedCatalogue();
    final draft = await repo.drafts.load(widget.visitClientId);
    if (!mounted) return;
    setState(() {
      _catalogue = catalogue.isEmpty ? const [] : catalogue;
      if (draft != null && draft.storeId == widget.storeId) {
        for (final l in draft.lines) {
          _qty[l.productId] = l.qty;
        }
        _note.text = draft.note ?? '';
        _contactName.text = draft.contactName ?? '';
        _contactPhone.text = draft.contactPhone ?? '';
        _requiredBy = draft.requiredBy;
      }
      _loading = false;
    });

    // Only if the cache was empty — the warm-up at the depot normally fills it,
    // and a rep at a shop door should not be waiting on the network.
    if (catalogue.isEmpty) {
      final fresh = await repo.fetchCatalogue();
      if (!mounted) return;
      setState(() => _catalogue = fresh);
    }
  }

  Future<void> _pickRequiredBy() async {
    final now = DateTime.now();
    // Today at the earliest: a delivery cannot be wanted in the past, and
    // `required_by` reads as a promise the warehouse works to.
    final first = DateTime(now.year, now.month, now.day);
    final last = first.add(const Duration(days: 365));

    // Clamped into the range. A draft written yesterday for "tomorrow" is
    // today; one written last week for a date since passed is behind `first`,
    // and showDatePicker asserts rather than coping when `initialDate` falls
    // outside — so restoring an old draft would crash the screen the rep is
    // trying to use.
    final restored = _requiredBy == null ? null : DateTime.tryParse(_requiredBy!);
    var initial = restored ?? first;
    if (initial.isBefore(first)) initial = first;
    if (initial.isAfter(last)) initial = last;

    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
      helpText: 'When does the shop want it?',
    );
    if (picked == null) return;
    setState(() {
      // `yyyy-MM-dd`, which is what `orders.required_by` stores. Built by hand
      // rather than with intl, because a locale-aware format here would send
      // 03/08 to a column expecting 2026-08-03.
      _requiredBy = '${picked.year.toString().padLeft(4, '0')}-'
          '${picked.month.toString().padLeft(2, '0')}-'
          '${picked.day.toString().padLeft(2, '0')}';
    });
    _persist();
  }

  Future<void> _persist() async {
    final lines = _lines();
    final repo = ref.read(orderRepositoryProvider);
    final note = _note.text.trim();
    final name = _contactName.text.trim();
    final phone = _contactPhone.text.trim();
    // A typed contact is worth keeping even with no lines yet — the rep may
    // have taken the name before the shopkeeper started listing products.
    if (lines.isEmpty &&
        note.isEmpty &&
        name.isEmpty &&
        phone.isEmpty &&
        _requiredBy == null) {
      await repo.drafts.clear(widget.visitClientId);
      ref.invalidate(orderDraftProvider(widget.visitClientId));
      return;
    }
    ref.invalidate(orderDraftProvider(widget.visitClientId));
    await repo.drafts.save(
      widget.visitClientId,
      OrderDraft(
        storeId: widget.storeId,
        lines: lines,
        note: note.isEmpty ? null : note,
        contactName: name.isEmpty ? null : name,
        contactPhone: phone.isEmpty ? null : phone,
        requiredBy: _requiredBy,
      ),
    );
  }

  List<OrderDraftLine> _lines() {
    final out = <OrderDraftLine>[];
    for (final entry in _qty.entries) {
      if (entry.value <= 0) continue;
      final p = _catalogue.where((x) => x.id == entry.key).firstOrNull;
      out.add(OrderDraftLine(
        productId: entry.key,
        qty: entry.value,
        unitsPerShrink: p?.unitsPerShrink,
        // No price from the phone. Customers sit on different pricing tiers,
        // so the rep is not the one who knows it — the warehouse sets it when
        // it confirms. See `OrderDraftLine.unitPrice` for why the field stays.
      ));
    }
    return out;
  }

  void _setQty(String productId, int qty) {
    setState(() {
      if (qty <= 0) {
        _qty.remove(productId);
      } else {
        _qty[productId] = qty;
      }
    });
    // Awaited nowhere on purpose: the write is small and the next thing that
    // happens may be the process being killed.
    _persist();
  }

  Future<void> _submit() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      setState(() => _error = 'Could not read your profile. Try again in a moment.');
      return;
    }
    final lines = _lines();
    if (lines.isEmpty) {
      setState(() => _error = 'Add at least one product.');
      return;
    }

    // The warehouse reserves in base units, so a line whose pack size is not on
    // record cannot be converted and must not be guessed at. Caught here, where
    // the product can be named, rather than at the sync boundary hours later
    // where the rep would never see it.
    final unsized = lines.where((l) => (l.unitsPerShrink ?? 0) <= 0).toList();
    if (unsized.isNotEmpty) {
      final names = unsized
          .map((l) =>
              _catalogue.where((p) => p.id == l.productId).firstOrNull?.name)
          .whereType<String>()
          .toList();
      setState(() => _error = names.length == unsized.length
          ? 'No pack size on record for ${names.join(', ')}, so the order '
              'cannot be sent. Take that line off to send the rest.'
          // A restored draft naming products this phone no longer has. Giving
          // the rep a bare id to puzzle over would help nobody.
          : 'This order cannot be sent until the product list reaches this '
              'phone. Open the app once where there is signal.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(orderRepositoryProvider).submitOrder(
            orgId: profile.orgId,
            repId: profile.id,
            storeId: widget.storeId,
            visitClientGeneratedId: widget.visitClientId,
            lines: lines,
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
            contactName:
                _contactName.text.trim().isEmpty ? null : _contactName.text.trim(),
            contactPhone:
                _contactPhone.text.trim().isEmpty ? null : _contactPhone.text.trim(),
            requiredBy: _requiredBy,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Order saved. It will reach the warehouse when you have signal.'),
        ),
      );
      ref.invalidate(orderDraftProvider(widget.visitClientId));
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
    final term = _search.text.trim().toLowerCase();
    final visible = term.isEmpty
        ? _catalogue
        : _catalogue.where((p) => p.searchText.contains(term)).toList();

    final lineCount = _qty.values.where((q) => q > 0).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Take an order'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(28),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                widget.storeName,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (_error != null)
                  Container(
                    width: double.infinity,
                    color: Theme.of(context).colorScheme.errorContainer,
                    padding: const EdgeInsets.all(12),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onErrorContainer,
                      ),
                    ),
                  ),
                if (_catalogue.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'No products have reached this phone yet. Open the app '
                      'once with signal and they will be there next time.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: TextField(
                    controller: _search,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search),
                      hintText: 'Search product, brand or code',
                    ),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: visible.length,
                    itemBuilder: (context, i) {
                      final p = visible[i];
                      final qty = _qty[p.id] ?? 0;
                      return _ProductRow(
                        product: p,
                        qty: qty,
                        onChanged: (q) => _setQty(p.id, q),
                      );
                    },
                  ),
                ),
                SafeArea(
                  top: false,
                  child: Container(
                    decoration: BoxDecoration(
                      border: Border(
                        top: BorderSide(color: Theme.of(context).dividerColor),
                      ),
                    ),
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _contactName,
                                onChanged: (_) => _persist(),
                                textCapitalization: TextCapitalization.words,
                                decoration: const InputDecoration(
                                  labelText: 'Who placed it',
                                  isDense: true,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextField(
                                controller: _contactPhone,
                                onChanged: (_) => _persist(),
                                keyboardType: TextInputType.phone,
                                decoration: const InputDecoration(
                                  labelText: 'Their phone',
                                  isDense: true,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        // A picker, not a text field. A date typed one-handed
                        // in a shop is a date entered wrong, and the format
                        // the column wants is not the format a person writes.
                        Row(
                          children: [
                            TextButton.icon(
                              onPressed: _pickRequiredBy,
                              icon: const Icon(Icons.event_outlined, size: 18),
                              label: Text(
                                _requiredBy == null
                                    ? 'Wanted by (optional)'
                                    : 'Wanted by $_requiredBy',
                              ),
                            ),
                            // A date set by mistake has to be removable. The
                            // picker has no "none", so clearing lives here.
                            if (_requiredBy != null)
                              IconButton(
                                onPressed: () {
                                  setState(() => _requiredBy = null);
                                  _persist();
                                },
                                icon: const Icon(Icons.close, size: 18),
                                tooltip: 'Clear the date',
                                visualDensity: VisualDensity.compact,
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        TextField(
                          controller: _note,
                          onChanged: (_) => _persist(),
                          decoration: const InputDecoration(
                            labelText: 'Note for the warehouse (optional)',
                            isDense: true,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '$lineCount line${lineCount == 1 ? '' : 's'}',
                                style: Theme.of(context).textTheme.bodyMedium,
                              ),
                            ),
                            FilledButton(
                              onPressed: _saving || lineCount == 0 ? null : _submit,
                              child: Text(_saving ? 'Saving…' : 'Save order'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Quantities are in shrinks. The warehouse prices the '
                          'order and confirms what is in stock.',
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: AppColors.textMuted,
                              ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _ProductRow extends StatelessWidget {
  const _ProductRow({
    required this.product,
    required this.qty,
    required this.onChanged,
  });

  final CatalogueProduct product;
  final int qty;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    // No price. Customers sit on different pricing tiers, so a figure shown
    // here would be quoted to a shopkeeper and then corrected on the invoice —
    // worse than showing nothing, because the shop believed the first one.
    final subtitle = [
      if (product.brand != null) product.brand!,
      if (product.unitsPerShrink != null) '${product.unitsPerShrink} per shrink',
    ].join(' · ');

    // What the warehouse will actually be asked to reserve, spelled out as the
    // rep counts. The same arithmetic the GRN screen shows on its own lines,
    // and for the same reason: a pack size applied silently is a pack size
    // nobody checks.
    final per = product.unitsPerShrink ?? 0;
    final ordered =
        qty > 0 && per > 0 ? '$qty × $per = ${qty * per} units' : null;

    return ListTile(
      title: Text(product.name),
      isThreeLine: subtitle.isNotEmpty && ordered != null,
      subtitle: subtitle.isEmpty && ordered == null
          ? null
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (subtitle.isNotEmpty) Text(subtitle),
                if (ordered != null)
                  Text(
                    ordered,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.navy,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
              ],
            ),
      trailing: SizedBox(
        width: 132,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            IconButton(
              // Big targets: this is used one-handed, standing up, often in
              // poor light.
              iconSize: 28,
              onPressed: qty > 0 ? () => onChanged(qty - 1) : null,
              icon: const Icon(Icons.remove_circle_outline),
            ),
            SizedBox(
              width: 32,
              child: Text(
                '$qty',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: qty > 0 ? FontWeight.bold : FontWeight.normal,
                      color: qty > 0 ? AppColors.navy : AppColors.textMuted,
                    ),
              ),
            ),
            IconButton(
              iconSize: 28,
              onPressed: () => onChanged(qty + 1),
              icon: const Icon(Icons.add_circle_outline),
            ),
          ],
        ),
      ),
    );
  }
}
