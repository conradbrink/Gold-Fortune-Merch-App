import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/company_config.dart';
import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/store_group.dart';
import '../../data/models/store_summary.dart';
import '../../data/repositories/route_repository.dart';
import 'store_picker_screen.dart';

const _uuid = Uuid();

/// A rep adds a shop that is not on the books, then goes straight into a
/// visit there so they can take its first order.
///
/// Owner, 29 Oct 2026: a rep meeting a new shop in the field had nowhere to
/// put it — an order needs a store, and only the office could add one. Every
/// field the warehouse needs to deliver is required here: the name, the
/// delivery address and who to ask for. The price group is the rep's pick
/// (the office can change it), and the position is taken from where the rep
/// is standing, so the check-in that follows is inside the geofence.
///
/// Works with no signal: the customer is on this phone at once and reaches
/// the server before the visit and the order that name it (`store_add`).
class NewCustomerScreen extends ConsumerStatefulWidget {
  const NewCustomerScreen({super.key});

  @override
  ConsumerState<NewCustomerScreen> createState() => _NewCustomerScreenState();
}

class _NewCustomerScreenState extends ConsumerState<NewCustomerScreen> {
  final _name = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _contact = TextEditingController();
  final _phone = TextEditingController();

  String? _groupId;
  Position? _position;
  bool _locating = true;
  String? _locationError;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _locate();
  }

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _city.dispose();
    _contact.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _locate() async {
    setState(() {
      _locating = true;
      _locationError = null;
    });
    Position? fix;
    String? problem;
    try {
      fix = await LocationService.getCheckInPosition();
      if (fix == null) {
        problem = "Couldn't get a fresh GPS fix.";
      }
    } on LocationDeniedException catch (e) {
      problem = e.message;
    } catch (_) {
      problem = "Couldn't get a GPS fix.";
    }
    if (!mounted) return;
    setState(() {
      _position = fix;
      _locationError = problem;
      _locating = false;
    });
  }

  bool get _ready =>
      _name.text.trim().isNotEmpty &&
      _address.text.trim().isNotEmpty &&
      _contact.text.trim().isNotEmpty &&
      _phone.text.trim().isNotEmpty;

  Future<void> _add() async {
    final profile = ref.read(profileProvider).value;
    if (profile == null) {
      setState(() => _error = 'Your profile has not loaded yet. Try again in a moment.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    // Asked again here, not only as the rep types: while the list is still
    // loading the warning under the name has nothing to compare against.
    final known = storesNamed(await ref.read(storesProvider.future), _name.text);
    if (!mounted) return;
    if (known.isNotEmpty) {
      setState(() => _saving = false);
      return;
    }
    try {
      final position = _position;
      final store = await ref.read(routeRepositoryProvider).addStoreFromPhone(
            storeId: _uuid.v4(),
            repId: profile.id,
            name: _name.text,
            address: _address.text,
            city: _city.text,
            lat: position?.latitude,
            lng: position?.longitude,
            accuracyM: position?.accuracy,
            storeGroupId: _groupId,
            contact: StoreContact(name: _contact.text.trim(), phone: _phone.text.trim()),
          );
      ref.invalidate(storesProvider);
      // Pushes it to the server now when there is signal; otherwise it waits
      // in the outbox like everything else.
      ref.read(syncEngineProvider).sync();
      final key = await startUnscheduledVisit(ref, store);
      if (!mounted) return;
      if (key == null) {
        setState(() => _saving = false);
        return;
      }
      context.go('/visit/$key');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = '$e';
      });
    }
  }

  Future<void> _useExisting(StoreSummary store) async {
    setState(() => _saving = true);
    final key = await startUnscheduledVisit(ref, store);
    if (!mounted) return;
    if (key == null) {
      setState(() => _saving = false);
      return;
    }
    context.go('/visit/$key');
  }

  @override
  Widget build(BuildContext context) {
    final t = ref.watch(termsProvider);
    final site = t.site.oneLower;
    final job = t.job.oneLower;
    final stores = ref.watch(storesProvider).value ?? const <StoreSummary>[];
    final groups = ref.watch(storeGroupsProvider).value ?? const <StoreGroup>[];
    final matches = storesNamed(stores, _name.text);

    return Scaffold(
      appBar: AppBar(title: Text('New $site')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          TextField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(
              labelText: 'Name of the $site',
              hintText: 'e.g. Riverside Traders',
            ),
            onChanged: (_) => setState(() {}),
          ),
          // The same name on the list already: offer that one rather than a
          // second copy the office would have to tidy up.
          for (final match in matches)
            Card(
              margin: const EdgeInsets.only(top: 8),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 20),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            match.location.isEmpty
                                ? '${match.name} is on your list already.'
                                : '${match.name} in ${match.location} is on '
                                    'your list already.',
                          ),
                        ),
                      ],
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: _saving ? null : () => _useExisting(match),
                        child: Text('Use that ${t.site.oneLower}'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _address,
            textCapitalization: TextCapitalization.words,
            keyboardType: TextInputType.streetAddress,
            minLines: 1,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Delivery address',
              hintText: 'Street and number, or how the driver finds it',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _city,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Town (optional)'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _contact,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Contact person',
              hintText: 'Who to ask for',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: 'Contact number',
              hintText: 'Mobile or landline',
            ),
            onChanged: (_) => setState(() {}),
          ),
          if (groups.isNotEmpty) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _groupId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Price group'),
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('None: product prices'),
                ),
                for (final g in groups)
                  DropdownMenuItem<String?>(value: g.id, child: Text(g.name)),
              ],
              onChanged: (v) => setState(() => _groupId = v),
            ),
          ],
          const SizedBox(height: 16),
          _PositionLine(
            locating: _locating,
            position: _position,
            problem: _locationError,
            onRetry: _locate,
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _saving || !_ready ? null : _add,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.add_business_outlined),
            label: Text(_saving ? 'Adding…' : 'Add and start $job'),
          ),
          const SizedBox(height: 8),
          Text(
            'The $site is saved on this phone at once and reaches the office '
            'when you have signal. You check in next, then take the order.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

/// Where the rep is standing, which becomes the position on the map.
class _PositionLine extends StatelessWidget {
  const _PositionLine({
    required this.locating,
    required this.position,
    required this.problem,
    required this.onRetry,
  });

  final bool locating;
  final Position? position;
  final String? problem;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodySmall;
    if (locating) {
      return Row(
        children: [
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 10),
          Text('Getting your position…', style: style),
        ],
      );
    }
    final fix = position;
    if (fix != null) {
      return Row(
        children: [
          const Icon(Icons.my_location, size: 16, color: AppColors.success),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Position recorded here, to within ${fix.accuracy.round()} m.',
              style: style,
            ),
          ),
        ],
      );
    }
    return Row(
      children: [
        const Icon(Icons.location_off_outlined, size: 16, color: AppColors.textMuted),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '${problem ?? "No position yet."} You can still add it; '
            'the office can place it on the map later.',
            style: style,
          ),
        ),
        TextButton(onPressed: onRetry, child: const Text('Try again')),
      ],
    );
  }
}
