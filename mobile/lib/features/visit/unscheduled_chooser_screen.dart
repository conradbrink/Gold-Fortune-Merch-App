import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/company_config.dart';
import '../../core/providers.dart';
import '../../core/terms.dart';
import '../../core/theme.dart';

/// Everything a rep starts that is not on today's list, behind the day's
/// "+ New" button (owner, 29 Oct 2026; it was "Unscheduled visit" until "New
/// order" joined it). Labels are one to three words (owner: "not make wording
/// too long for labels"); what each does goes in the small text under it.
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
    // Sales visits and leads belong to the Distribution module.
    final hasSales = ref.watch(companyConfigValueProvider).has('distribution');
    final open = hasSales ? ref.watch(myLeadsProvider) : null;
    final t = ref.watch(termsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('New')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Choice(
            icon: Icons.storefront_outlined,
            title: '${t.site.one} ${t.job.oneLower}',
            body:
                "${capital(t.site.withArticle)} that is not on today's list. Checks "
                'in with the usual position and time, then the normal '
                '${t.job.oneLower}: forms, photos, check-out.',
            onTap: () => context.go('/unscheduled/store'),
          ),
          if (hasSales) ...[
          const SizedBox(height: 12),
          // An order the customer sent rather than gave the rep in the shop.
          // Named for what it is, not for how it came: WhatsApp is one answer
          // to "How they ordered" on the next screen (owner, 29 Oct 2026).
          _Choice(
            icon: Icons.receipt_long_outlined,
            title: 'New order',
            body:
                'An order ${t.site.withArticle} sent you, on WhatsApp, over the '
                'phone, by email or any other way. Choose the '
                '${t.site.oneLower} and type it in. You don\'t check in, and '
                'nobody signs.',
            onTap: () => context.go('/unscheduled/order'),
          ),
          const SizedBox(height: 12),
          _Choice(
            icon: Icons.add_business_outlined,
            title: 'New ${t.site.oneLower}',
            body:
                'Not on your list yet and wants to order. Add the name, '
                'delivery address and contact, then check in and take the '
                'order.',
            onTap: () => context.go('/unscheduled/new'),
          ),
          const SizedBox(height: 12),
          _Choice(
            icon: Icons.handshake_outlined,
            title: 'Sales ${t.job.oneLower}',
            body:
                'A new or prospective ${t.client.oneLower} — approaching '
                '${t.site.withArticle} to ask for a listing. Records who you '
                'saw and what came of it.',
            onTap: () => context.go('/unscheduled/sales'),
          ),
          ],

          // Anything still open is offered back. A call started and never
          // closed off is a lead with no outcome, which helps nobody.
          if (open != null)
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
                subtitle: Text(
                  'You may already have one open for this ${t.site.oneLower}.',
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
                backgroundColor: context.brand.primary,
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
