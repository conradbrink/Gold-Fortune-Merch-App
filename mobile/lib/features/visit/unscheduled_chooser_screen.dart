import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';

/// What kind of unscheduled call this is.
///
/// The button used to go straight to the store picker, which quietly assumed
/// every unplanned call is to a shop already on the estate. The other kind —
/// walking into somewhere that stocks nothing of ours — had nowhere to go, so
/// it was either not recorded or recorded against the wrong store.
///
/// Store check-in is unchanged behind this screen: same picker, same geofence,
/// same forms, same check-out.
class UnscheduledChooserScreen extends ConsumerWidget {
  const UnscheduledChooserScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final open = ref.watch(myLeadsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Unscheduled visit')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Choice(
            icon: Icons.storefront_outlined,
            title: 'Store check-in',
            body:
                'A shop already on your list. Checks in with the usual position '
                'and time, then the normal visit: forms, photos, check-out.',
            onTap: () => context.go('/unscheduled/store'),
          ),
          const SizedBox(height: 12),
          _Choice(
            icon: Icons.handshake_outlined,
            title: 'Sales visit',
            body:
                'A new or prospective customer — approaching a shop to ask for '
                'a listing. Records who you saw and what came of it.',
            onTap: () => context.go('/unscheduled/sales'),
          ),

          // Anything still open is offered back. A call started and never
          // closed off is a lead with no outcome, which helps nobody.
          open.maybeWhen(
            data: (leads) {
              final unfinished = leads.where((l) => !l.isComplete).toList();
              if (unfinished.isEmpty) return const SizedBox.shrink();
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 24),
                  Text(
                    'Still open',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  for (final lead in unfinished)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: const Icon(Icons.pending_actions_outlined),
                        title: Text(lead.companyName),
                        subtitle: Text(lead.purpose),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => context.go(
                          '/unscheduled/sales/${lead.clientGeneratedId}',
                        ),
                      ),
                    ),
                ],
              );
            },
            // An unreadable cache must not look like "nothing is open". The
            // whole point of this section is to stop a rep starting a second
            // call on a shop they already have one open for, and collapsing to
            // nothing is exactly how that would happen — silently.
            error: (e, _) => Card(
              margin: const EdgeInsets.only(top: 24),
              child: ListTile(
                leading: const Icon(Icons.error_outline, color: AppColors.danger),
                title: const Text('Could not read your open calls'),
                subtitle: const Text(
                  'You may already have one open for this shop.',
                ),
                trailing: TextButton(
                  onPressed: () => ref.invalidate(myLeadsProvider),
                  child: const Text('Retry'),
                ),
              ),
            ),
            orElse: () => const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({
    required this.icon,
    required this.title,
    required this.body,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String body;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                backgroundColor: AppColors.navy,
                foregroundColor: Colors.white,
                child: Icon(icon),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      body,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
