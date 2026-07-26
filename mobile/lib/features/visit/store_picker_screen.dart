import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/route_visit.dart';
import '../../data/models/store_summary.dart';

const _uuid = Uuid();

/// Lets a rep start a visit at a store nobody scheduled — covering for a
/// colleague, a call-out from the manager, or a store they happened to pass.
///
/// The store list is served from the local cache when offline, which is when
/// an unscheduled visit is most likely to happen.
class StorePickerScreen extends ConsumerStatefulWidget {
  const StorePickerScreen({super.key});

  @override
  ConsumerState<StorePickerScreen> createState() => _StorePickerScreenState();
}

class _StorePickerScreenState extends ConsumerState<StorePickerScreen> {
  String _query = '';
  bool _busy = false;

  Future<void> _start(StoreSummary store) async {
    if (_busy) return;
    setState(() => _busy = true);

    final date = ref.read(selectedRouteDateProvider);
    final visit = RouteVisit.unscheduled(
      clientId: _uuid.v4(),
      storeId: store.id,
      storeName: store.name,
      storeAddress: store.address,
      storeCity: store.city,
      storeState: store.state,
      storeLat: store.lat,
      storeLng: store.lng,
      geofenceRadiusM: store.geofenceRadiusM,
    );

    await ref.read(routeRepositoryProvider).addUnscheduledVisit(visit, date);
    ref.invalidate(todayRoutesProvider);

    if (!mounted) return;
    context.go('/visit/${visit.cacheKey}');
  }

  @override
  Widget build(BuildContext context) {
    final storesAsync = ref.watch(storesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Unscheduled visit')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              autofocus: true,
              onChanged: (v) => setState(() => _query = v),
              decoration: const InputDecoration(
                hintText: 'Search stores',
                prefixIcon: Icon(Icons.search),
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
                  return const _EmptyNotice(
                    'No stores available yet. Connect once so your store list '
                    'is saved to this device.',
                  );
                }
                if (filtered.isEmpty) {
                  return const _EmptyNotice('No stores match that search.');
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
                            color: AppColors.gold.withValues(alpha: 0.18),
                            borderRadius: BorderRadius.circular(11),
                          ),
                          child: const Icon(Icons.storefront_outlined,
                              color: AppColors.navy),
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
                        onTap: _busy ? null : () => _start(store),
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
