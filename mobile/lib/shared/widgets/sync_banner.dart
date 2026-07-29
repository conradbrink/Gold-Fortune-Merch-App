import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/sync/sync_engine.dart';

/// Thin strip telling the rep whether their work has reached the server.
/// Stays hidden when everything is synced so it doesn't add noise.
class SyncBanner extends ConsumerWidget {
  const SyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pending = ref.watch(pendingSyncCountProvider).value ?? 0;
    final status = ref.watch(syncStatusProvider).value;
    final state = status?.state ?? SyncState.idle;

    if (pending == 0 && state != SyncState.offline) {
      return const SizedBox.shrink();
    }

    late final Color color;
    late final IconData icon;
    late final String label;

    switch (state) {
      case SyncState.offline:
        color = AppColors.warning;
        icon = Icons.cloud_off;
        label = pending == 0
            ? 'Offline — your work will be saved on this device'
            : 'Offline — $pending change${pending == 1 ? '' : 's'} waiting to sync';
      case SyncState.syncing:
        color = AppColors.info;
        icon = Icons.sync;
        label = 'Syncing $pending change${pending == 1 ? '' : 's'}…';
      case SyncState.error:
        color = AppColors.danger;
        icon = Icons.error_outline;
        label = "Sync issue — $pending change${pending == 1 ? '' : 's'} still queued";
      case SyncState.idle:
        color = AppColors.info;
        icon = Icons.cloud_queue;
        label = '$pending change${pending == 1 ? '' : 's'} waiting to sync';
    }

    return Container(
      width: double.infinity,
      color: color.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: color,
              ),
            ),
          ),
          if (state != SyncState.syncing && pending > 0)
            InkWell(
              onTap: () => ref.read(syncEngineProvider).sync(),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                child: Text(
                  'Retry',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
