import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/local/order_draft.dart';
import '../../data/models/catalogue_product.dart';
import '../../data/models/order_received_via.dart';
import '../../data/models/store_group.dart';
import '../../data/models/store_reorder.dart';
import 'order_sign_sheet.dart';

/// What a new order says when it is saved without how it came.
const _askHowTheyOrdered = 'Choose how they ordered before saving.';

/// Taking an order in the shop, or typing in a new order a customer sent.
///
/// The two differ only at the end. In the shop the manager signs for it on the
/// rep's phone. A new order has nobody there to sign (owner, 29 Oct 2026):
/// there is no visit and no check-in, and the rep says how it came instead.
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
  /// An order taken on a checked-in visit, signed for in the shop.
  const OrderCaptureScreen({
    super.key,
    required String this.visitClientId,
    required this.storeId,
    required this.storeName,
    required String this.visitKey,
    this.storeAddress,
  }) : draftId = visitClientId;

  /// A new order the customer sent: no visit, no signature, kept under
  /// [OrderDraft.newOrderId] while it is typed.
  const OrderCaptureScreen.newOrder({
    super.key,
    required this.draftId,
    required this.storeId,
    required this.storeName,
    this.storeAddress,
  })  : visitClientId = null,
        visitKey = null;

  /// The visit this order is taken on; null for a new order.
  final String? visitClientId;

  /// Where the half-typed order is kept: the visit's client id in the shop.
  final String draftId;
  final String storeId;
  final String storeName;

  /// The customer's address as the day has it ("12 Main Road, Mahikeng"),
  /// which the delivery address starts as. Null when none is on record.
  final String? storeAddress;

  /// Where leaving this screen goes back to. Held rather than popped, because
  /// this is a route now (`/visit/:key/order`) and not an imperative push —
  /// see the comment on the button that opens it. Null for a new order, which
  /// goes back to the day.
  final String? visitKey;

  @override
  ConsumerState<OrderCaptureScreen> createState() => _OrderCaptureScreenState();
}

class _OrderCaptureScreenState extends ConsumerState<OrderCaptureScreen> {
  final _search = TextEditingController();
  final _note = TextEditingController();
  final _contactName = TextEditingController();
  final _contactPhone = TextEditingController();
  final _deliveryAddress = TextEditingController();
  final Map<String, int> _qty = {};

  /// When the shop wants it, as `yyyy-MM-dd`, or null for "no date given".
  ///
  /// Held as a string rather than a DateTime because that is what
  /// `orders.required_by` is and what the draft round-trips; converting at two
  /// boundaries instead of one is how a date drifts by a day.
  String? _requiredBy;

  /// How the customer sent a new order, once the rep has said: one of
  /// [orderSentChoices]. Required before a new order saves; unused in the shop.
  String? _receivedVia;

  bool get _inShop => widget.visitClientId != null;

  bool _loading = true;
  bool _saving = false;
  String? _error;

  /// Set once "Same as last order" has filled the list: what was left out.
  /// Null until then; the note under the search says what happened.
  int? _leftOut;
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
    _deliveryAddress.dispose();
    super.dispose();
  }

  Future<void> _restore() async {
    final repo = ref.read(orderRepositoryProvider);
    final catalogue = await repo.cachedCatalogue();
    final draft = await repo.drafts.load(widget.draftId);
    // Who this phone last took an order from here, or who the rep named when
    // they added the customer: the delivery details are required on every
    // order (owner, 29 Oct 2026), so they start filled in wherever they can.
    final lastContact =
        await ref.read(routeRepositoryProvider).contactFor(widget.storeId);
    if (!mounted) return;
    setState(() {
      _catalogue = catalogue.isEmpty ? const [] : catalogue;
      final ours = draft != null && draft.storeId == widget.storeId;
      if (ours) {
        for (final l in draft.lines) {
          _qty[l.productId] = l.qty;
        }
        _note.text = draft.note ?? '';
        _contactName.text = draft.contactName ?? '';
        _contactPhone.text = draft.contactPhone ?? '';
        _deliveryAddress.text = draft.deliveryAddress ?? '';
        _requiredBy = draft.requiredBy;
        if (isOrderSentChoice(draft.receivedVia)) _receivedVia = draft.receivedVia;
      }
      // Only into an empty box: what the rep typed on the draft stands.
      if (_contactName.text.isEmpty) _contactName.text = lastContact?.name ?? '';
      if (_contactPhone.text.isEmpty) _contactPhone.text = lastContact?.phone ?? '';
      if (_deliveryAddress.text.isEmpty) {
        _deliveryAddress.text = widget.storeAddress ?? '';
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
      helpText: 'When does the ${ref.read(termsProvider).site.oneLower} want it?',
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
    // Captured **before** any await, while this widget is certainly mounted.
    //
    // The container outlives the widget; the widget's own `ref` does not, which
    // is what threw when a save landed after disposal. Guarding the invalidate
    // behind `mounted` stopped the crash and traded away the refresh — and
    // `orderDraftProvider` is not auto-disposed, so a *mounted* StoreDetailScreen
    // would go on showing the old "Order in progress · N" indefinitely, not just
    // until the next tap. Keeping both is the point: the write happens, and the
    // thing that reads it is told.
    final container = ProviderScope.containerOf(context, listen: false);
    final note = _note.text.trim();
    final name = _contactName.text.trim();
    final phone = _contactPhone.text.trim();
    final address = _deliveryAddress.text.trim();
    // A typed contact is worth keeping even with no lines yet — the rep may
    // have taken the name before the shopkeeper started listing products.
    // The address the screen filled in by itself is not something typed.
    final typedAddress = address.isNotEmpty && address != (widget.storeAddress ?? '');
    if (lines.isEmpty &&
        note.isEmpty &&
        name.isEmpty &&
        phone.isEmpty &&
        !typedAddress &&
        _requiredBy == null &&
        _receivedVia == null) {
      await repo.drafts.clear(widget.draftId);
      // #20 moved this invalidate *after* the await on purpose, so the store
      // screen's "Order in progress" count could never read one edit stale.
      // Through the container rather than `ref`, so that stays true even when
      // this screen is gone by the time the write lands.
      container.invalidate(orderDraftProvider(widget.draftId));
      return;
    }
    await repo.drafts.save(
      widget.draftId,
      OrderDraft(
        storeId: widget.storeId,
        lines: lines,
        note: note.isEmpty ? null : note,
        contactName: name.isEmpty ? null : name,
        contactPhone: phone.isEmpty ? null : phone,
        deliveryAddress: address.isEmpty ? null : address,
        requiredBy: _requiredBy,
        receivedVia: _receivedVia,
      ),
    );
    // After the write, as the clear branch above already does. Invalidating
    // first lets a listener refetch while the old draft is still on disk, and
    // nothing fires again afterwards — so the store screen's "Order in
    // progress · N products" line could sit one edit behind what the rep
    // typed. Sent by CodeRabbit outside the diff on PR #19, after the merge.
    //
    // Through the container for the same reason as the clear branch: the write
    // has already happened, and the screen that reads it must be told whether or
    // not this one survived to see it.
    container.invalidate(orderDraftProvider(widget.draftId));
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
        // No price from the phone. Each line is priced in the office as it
        // arrives, from the store's price list (`order_lines_price_from_list`).
        // See `OrderDraftLine.unitPrice` for why the field stays.
      ));
    }
    return out;
  }

  /// Fills the list with the store's last order, in shrinks, for the rep to
  /// change. Products this phone cannot order are left out and counted, so the
  /// rep can ask about them rather than lose them in silence.
  void _fillFromLast(StoreReorder last) {
    final orderable = {for (final p in _catalogue) p.id};
    var leftOut = last.lastLinesMissing;
    setState(() {
      for (final l in last.lastLines) {
        if (orderable.contains(l.productId) && l.shrinks > 0) {
          _qty[l.productId] = l.shrinks;
        } else {
          leftOut += 1;
        }
      }
      _leftOut = leftOut;
    });
    _persist();
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

    if (!_inShop && _receivedVia == null) {
      setState(() => _error = _askHowTheyOrdered);
      return;
    }

    // Where it goes and who to ask for, on every order (owner, 29 Oct 2026):
    // a driver with no address or number cannot deliver it.
    final contact = _contactName.text.trim();
    final contactPhone = _contactPhone.text.trim();
    final deliveryAddress = _deliveryAddress.text.trim();
    final missing = missingDeliveryDetails(
      address: deliveryAddress,
      contactName: contact,
      contactPhone: contactPhone,
    );
    if (missing != null) {
      setState(() => _error = missing);
      return;
    }

    // The manager signs for an order taken in the shop before it is saved
    // (owner, 27 Oct 2026). Closing the sheet leaves the draft. A new order
    // has nobody there to sign: how it came stands in for that.
    setState(() => _error = null);
    OrderSignature? signature;
    if (_inShop) {
      signature = await showOrderSignSheet(
        context,
        lineCount: lines.length,
        storeName: widget.storeName,
        signerName: contact,
      );
      if (signature == null || !mounted) return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(orderRepositoryProvider).submitOrder(
            signature: signature,
            orgId: profile.orgId,
            repId: profile.id,
            storeId: widget.storeId,
            visitClientGeneratedId: widget.visitClientId,
            draftId: widget.draftId,
            receivedVia: _receivedVia ?? orderTakenInShop,
            lines: lines,
            note: _note.text.trim().isEmpty ? null : _note.text.trim(),
            contactName: contact,
            contactPhone: contactPhone,
            deliveryAddress: deliveryAddress,
            requiredBy: _requiredBy,
          );
      // Only fills in the next order. The order is queued by now, so a
      // failure here must not read as the save failing: the rep would save
      // it again.
      try {
        await ref.read(routeRepositoryProvider).rememberContact(
              widget.storeId,
              StoreContact(name: contact, phone: contactPhone),
            );
      } catch (_) {}
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Order saved. It will reach the warehouse when you have signal.'),
        ),
      );
      ref.invalidate(orderDraftProvider(widget.draftId));
      ref.invalidate(ordersTakenProvider);
      ref.invalidate(storeReorderProvider);
      final visitKey = widget.visitKey;
      context.go(visitKey == null ? '/' : '/visit/$visitKey');
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
    // The store's last order, from the list warmed with the day. Offered only
    // on an empty order: on top of lines already typed it would be a guess at
    // which of the two the rep meant.
    final last = ref.watch(storeReorderProvider).maybeWhen(
          data: (all) => all[widget.storeId],
          orElse: () => null,
        );
    // Something the phone can actually put in: the products must be in this
    // phone's list, or the button would do nothing.
    final orderable = {for (final p in _catalogue) p.id};
    final fillable = last == null
        ? 0
        : last.lastLines.where((l) => orderable.contains(l.productId)).length;
    final canFill = fillable > 0 && lineCount == 0 && _leftOut == null;

    return Scaffold(
      appBar: AppBar(
        title: Text(_inShop ? 'Take an order' : 'New order'),
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
                if (!_inShop)
                  _HowTheyOrdered(
                    value: _receivedVia,
                    onChanged: (v) {
                      setState(() {
                        _receivedVia = v;
                        if (_error == _askHowTheyOrdered) _error = null;
                      });
                      _persist();
                    },
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
                if (canFill)
                  _SameAgainBanner(
                    last: last!,
                    onFill: () => _fillFromLast(last),
                  )
                else if (_leftOut != null && lineCount > 0)
                  _FilledNote(leftOut: _leftOut!),
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
                        TextField(
                          controller: _deliveryAddress,
                          onChanged: (_) => _persist(),
                          textCapitalization: TextCapitalization.words,
                          keyboardType: TextInputType.streetAddress,
                          decoration: const InputDecoration(
                            labelText: 'Delivery address',
                            isDense: true,
                          ),
                        ),
                        const SizedBox(height: 6),
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
                              child: Text(_saving
                                  ? 'Saving…'
                                  : _inShop
                                      ? 'Sign and save'
                                      : 'Save order'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          // Priced in the office as it arrives, from the
                          // store's price list (20261015210000); the phone
                          // still sends no price.
                          'Quantities are in shrinks. Prices come from the '
                          "${ref.watch(termsProvider).site.oneLower}'s price list, and the warehouse "
                          'confirms what is in stock.',
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

/// What stops an order being saved for want of delivery details, as the
/// message the rep reads, or null when all three are there (owner, 29 Oct
/// 2026: every order carries where it goes and who to ask for).
String? missingDeliveryDetails({
  required String address,
  required String contactName,
  required String contactPhone,
}) {
  final missing = [
    if (address.trim().isEmpty) 'the delivery address',
    if (contactName.trim().isEmpty) 'who placed it',
    if (contactPhone.trim().isEmpty) 'their phone number',
  ];
  if (missing.isEmpty) return null;
  final listed = missing.length == 1
      ? missing.single
      : '${missing.sublist(0, missing.length - 1).join(', ')} and ${missing.last}';
  return 'Fill in $listed before saving.';
}

/// "How did they order?": the one thing a new order says that one taken in
/// the shop does not. No answer is chosen for the rep: a wrong default would
/// tell the office an email came that never did.
class _HowTheyOrdered extends StatelessWidget {
  const _HowTheyOrdered({required this.value, required this.onChanged});

  final String? value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('How did they order?', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final c in orderSentChoices)
                ChoiceChip(
                  label: Text(c.label),
                  selected: value == c.value,
                  onSelected: (_) => onChanged(c.value),
                ),
            ],
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
    // No price. The office prices the order from the store's price list as
    // it arrives; a figure shown here could be quoted to a shopkeeper and then
    // differ on the invoice — worse than showing nothing, because the shop
    // believed the first one.
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
                          color: context.brand.primary,
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
                      color: qty > 0 ? context.brand.primary : AppColors.textMuted,
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

/// "Same as last order": one tap fills the list with what the store ordered
/// last time, for the rep to change.
class _SameAgainBanner extends StatelessWidget {
  const _SameAgainBanner({required this.last, required this.onFill});

  final StoreReorder last;
  final VoidCallback onFill;

  @override
  Widget build(BuildContext context) {
    final n = last.lastLines.length;
    final when = last.lastOrderOn == null ? '' : ' on ${dayMonth(last.lastOrderOn!)}';
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        decoration: BoxDecoration(
          color: context.brand.accent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Their last order$when had $n '
                '${n == 1 ? 'product' : 'products'}.',
                style: const TextStyle(fontSize: 13, color: AppColors.textPrimary),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton.icon(
              onPressed: onFill,
              icon: const Icon(Icons.replay, size: 18),
              label: const Text('Same again'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Said once the list was filled from the last order.
class _FilledNote extends StatelessWidget {
  const _FilledNote({required this.leftOut});

  final int leftOut;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Text(
        'Filled in from their last order. Change any number before you save.'
        '${leftOut == 0 ? '' : leftOut == 1 ? ' One product from it can\'t be ordered from the phone and was left out.' : ' $leftOut products from it can\'t be ordered from the phone and were left out.'}',
        style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted),
      ),
    );
  }
}
