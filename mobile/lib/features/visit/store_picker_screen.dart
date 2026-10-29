import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/route_visit.dart';
import '../../data/models/store_summary.dart';

const _uuid = Uuid();

/// Puts an unscheduled visit to [store] on today's list, on this phone, and
/// returns its key for `/visit/:key`. Shared by the picker and by adding a
/// new customer, which goes straight on to a visit there.
///
/// Null when nobody is signed in — the session dropped under the rep — since
/// the visit has to be somebody's. The router is already taking them to sign
/// in, and back here after.
Future<String?> startUnscheduledVisit(WidgetRef ref, StoreSummary store) async {
  final date = ref.read(selectedRouteDateProvider);
  final repId = ref.read(currentUserProvider)?.id;
  if (repId == null) return null;
  final visit = RouteVisit.unscheduled(
    clientId: _uuid.v4(),
    storeId: store.id,
    storeName: store.name,
    storeAddress: store.address,
    storeCity: store.city,
    storeState: store.state,
    storeLat: store.lat,
    storeLng: store.lng,
    storeGeocodeSource: store.geocodeSource,
    geofenceRadiusM: store.geofenceRadiusM,
  );

  await ref.read(routeRepositoryProvider).addUnscheduledVisit(repId, visit, date);
  ref.invalidate(todayRoutesProvider);
  return visit.cacheKey;
}

/// Lets a rep start a visit at a store nobody scheduled — covering for a
/// colleague, a call-out from the manager, or a store they happened to pass.
/// With [forOrder], picks the customer for a new order they sent instead, and
/// starts no visit.
///
/// The store list is served from the local cache when offline, which is when
/// an unscheduled visit is most likely to happen.
class StorePickerScreen extends ConsumerStatefulWidget {
  const StorePickerScreen({super.key, this.forOrder = false});

  /// Picking who a new order is for (`/unscheduled/order`), not where to
  /// check in.
  final bool forOrder;

  @override
  ConsumerState<StorePickerScreen> createState() => _StorePickerScreenState();
}

class _StorePickerScreenState extends ConsumerState<StorePickerScreen> {
  String _query = '';
  bool _busy = false;

  Future<void> _start(StoreSummary store) async {
    if (_busy) return;
    setState(() => _busy = true);
    final key = await startUnscheduledVisit(ref, store);
    if (!mounted) return;
    if (key == null) {
      setState(() => _busy = false);
      return;
    }
    context.go('/visit/$key');
  }

  @override
  Widget build(BuildContext context) {
    final storesAsync = ref.watch(storesProvider);
    final t = ref.watch(termsProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.forOrder ? 'New order' : 'Choose the ${t.site.oneLower}'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              // Not for a new order: the rep comes back here from the order
              // screen, and the keyboard would cover the list each time.
              autofocus: !widget.forOrder,
              onChanged: (v) => setState(() => _query = v),
              decoration: InputDecoration(
                hintText: 'Search ${t.site.manyLower}',
                prefixIcon: const Icon(Icons.search),
              ),
            ),
          ),
          Expanded(
            child: storesAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('$e')),
              data: (stores) {
                final q = _query.trim().toLowerCase();
                final filtered = q.isEmpty
                    ? stores
                    : stores
                        .where((s) =>
                            s.name.toLowerCase().contains(q) ||
                            s.location.toLowerCase().contains(q))
                        .toList();

                if (stores.isEmpty) {
                  return _EmptyNotice(
                    'No ${t.site.manyLower} available yet. Connect once so '
                    'your ${t.site.oneLower} list is saved to this device.',
                  );
                }
                if (filtered.isEmpty) {
                  return Column(
                    children: [
                      Expanded(
                        child: _EmptyNotice(
                          'No ${t.site.manyLower} match that search.',
                        ),
                      ),
                      // Orders belong to the Distribution module, and a new
                      // customer is only added to take one. For a new order it
                      // goes on to that order, not to a check-in.
                      if (ref.watch(companyConfigValueProvider).has('distribution'))
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: OutlinedButton.icon(
                            onPressed: () => context.go(
                              widget.forOrder ? '/unscheduled/order/new' : '/unscheduled/new',
                            ),
                            icon: const Icon(Icons.add_business_outlined),
                            label: Text('Add a new ${t.site.oneLower}'),
                          ),
                        ),
                    ],
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: filtered.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, i) {
                    final store = filtered[i];
                    return Card(
                      margin: EdgeInsets.zero,
                      child: ListTile(
                        leading: Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: context.brand.accent.withValues(alpha: 0.18),
                            borderRadius: BorderRadius.circular(11),
                          ),
                          child: Icon(Icons.storefront_outlined,
                              color: context.brand.primary),
                        ),
                        title: Text(
                          store.name,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 14.5,
                          ),
                        ),
                        subtitle: store.location.isEmpty
                            ? null
                            : Text(store.location,
                                style: const TextStyle(fontSize: 12.5)),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: _busy
                            ? null
                            : widget.forOrder
                                ? () => context.go('/unscheduled/order/${store.id}')
                                : () => _start(store),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyNotice extends StatelessWidget {
  const _EmptyNotice(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
        ),
      ),
    );
  }
}
