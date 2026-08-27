import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../data/models/hr.dart';
import 'leave_request_sheet.dart';

/// The rep's own HR record: leave, and anything on their file.
///
/// The whole HR module has existed on the web since it was built, and reps have
/// no browser habit and often no work email — so in practice it existed for
/// managers only. Leave was applied for by telling somebody, and a sick note
/// was a photograph in a WhatsApp thread. This is the same records, in the one
/// place the people they belong to actually are.
///
/// Two tabs, not seven. Attendance, reviews and cases are all readable on the
/// web page and none of them is something a rep does anything about from a
/// phone; leave and warnings both have an action attached, which is what earns
/// a screen here.
class MyHrScreen extends ConsumerWidget {
  const MyHrScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final employeeId = ref.watch(myEmployeeIdProvider);

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My leave and file'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Leave'),
              Tab(text: 'On my file'),
            ],
          ),
        ),
        body: employeeId.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => _Message(
            icon: Icons.wifi_off_outlined,
            title: 'This needs a connection',
            body:
                'Your leave record lives on the server and is not kept on the '
                'phone. Try again where you have signal.',
          ),
          data: (id) {
            if (id == null) {
              // Not an error. The HR module links an employee record to a
              // login, and somebody can have an account before anyone has made
              // them an employee — showing a balance of zero would read as "you
              // have no leave", which is a different and much worse claim.
              return const _Message(
                icon: Icons.badge_outlined,
                title: 'No employee record yet',
                body:
                    'Your account is not linked to an employee file, so there '
                    'is no leave to show. Ask your manager to set one up.',
              );
            }
            return TabBarView(
              children: [
                _LeaveTab(employeeId: id),
                _FileTab(employeeId: id),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _LeaveTab extends ConsumerWidget {
  const _LeaveTab({required this.employeeId});

  final String employeeId;

  Future<void> _apply(BuildContext context, WidgetRef ref) async {
    final profile = await ref.read(profileProvider.future);
    if (profile == null || !context.mounted) return;
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => LeaveRequestSheet(
        orgId: profile.orgId,
        employeeId: employeeId,
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balances = ref.watch(myLeaveBalancesProvider);
    final requests = ref.watch(myLeaveRequestsProvider);

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _apply(context, ref),
        backgroundColor: AppColors.navy,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.event_available_outlined),
        label: const Text('Apply for leave'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(myLeaveBalancesProvider);
          ref.invalidate(myLeaveRequestsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            const _SectionTitle('Your balance'),
            balances.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => const Text('Your balance could not be loaded.'),
              data: (rows) => rows.isEmpty
                  ? const Text(
                      'No leave types are set up yet.',
                      style: TextStyle(color: AppColors.textMuted),
                    )
                  : Column(children: [for (final b in rows) _BalanceCard(b)]),
            ),
            const SizedBox(height: 24),
            const _SectionTitle('Your requests'),
            requests.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => const Text('Your requests could not be loaded.'),
              data: (rows) => rows.isEmpty
                  ? const Text(
                      'You have not applied for any leave.',
                      style: TextStyle(color: AppColors.textMuted),
                    )
                  : Column(
                      children: [
                        for (final r in rows) _RequestCard(request: r),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard(this.balance);

  final LeaveBalance balance;

  static String _n(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(balance.leaveTypeName,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(
                    balance.deductsFromBalance
                        ? '${_n(balance.usedDays)} taken · '
                            '${_n(balance.pendingDays)} awaiting a decision'
                        : 'Tracked, but does not come off a balance',
                    style: const TextStyle(
                        color: AppColors.textMuted, fontSize: 12),
                  ),
                ],
              ),
            ),
            if (balance.deductsFromBalance)
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    _n(balance.remainingDays),
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      color: AppColors.navy,
                    ),
                  ),
                  const Text('days left',
                      style: TextStyle(
                          color: AppColors.textMuted, fontSize: 11)),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _RequestCard extends ConsumerWidget {
  const _RequestCard({required this.request});

  final LeaveRequest request;

  static const _statusColours = {
    'pending': AppColors.warning,
    'approved': AppColors.success,
    'rejected': AppColors.danger,
    'cancelled': AppColors.textMuted,
    'withdrawn': AppColors.textMuted,
  };

  Future<void> _withdraw(BuildContext context, WidgetRef ref) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Take this request back?'),
        content: const Text(
          'It disappears from your manager\'s list. You can apply again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Take it back'),
          ),
        ],
      ),
    );
    if (sure != true) return;
    try {
      await ref.read(hrRepositoryProvider).withdraw(request.id);
      ref.invalidate(myLeaveRequestsProvider);
      ref.invalidate(myLeaveBalancesProvider);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('It could not be withdrawn.\n$e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fmt = DateFormat('d MMM');
    final colour = _statusColours[request.status] ?? AppColors.textMuted;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    request.leaveTypeName,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: colour.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    request.status,
                    style: TextStyle(
                        color: colour,
                        fontSize: 11,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${fmt.format(request.startDate)} — '
              '${DateFormat('d MMM yyyy').format(request.endDate)} · '
              '${request.days} ${request.days == 1 ? 'day' : 'days'}',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
            if (request.reason != null && request.reason!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(request.reason!, style: const TextStyle(fontSize: 13)),
            ],
            if (request.decisionNote != null &&
                request.decisionNote!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                'Note from your manager: ${request.decisionNote}',
                style: const TextStyle(fontSize: 12, color: AppColors.navy),
              ),
            ],
            Row(
              children: [
                if (request.hasDocument)
                  const Padding(
                    padding: EdgeInsets.only(top: 6, right: 12),
                    child: Row(
                      children: [
                        Icon(Icons.attach_file,
                            size: 14, color: AppColors.textMuted),
                        SizedBox(width: 4),
                        Text('Note attached',
                            style: TextStyle(
                                fontSize: 11, color: AppColors.textMuted)),
                      ],
                    ),
                  ),
                const Spacer(),
                if (request.canWithdraw)
                  TextButton(
                    onPressed: () => _withdraw(context, ref),
                    child: const Text('Take it back'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Warnings on this rep's file, and the acknowledgement.
///
/// Acknowledging is "I have seen this", not "I agree with it", and the button
/// says so — a system that feeds disciplinary hearings must not let a tap be
/// read afterwards as consent.
class _FileTab extends ConsumerWidget {
  const _FileTab({required this.employeeId});

  final String employeeId;

  Future<void> _open(BuildContext context, WidgetRef ref, String path) async {
    try {
      final url = await ref.read(hrRepositoryProvider).signedUrl(path);
      if (!await launchUrl(Uri.parse(url),
          mode: LaunchMode.externalApplication)) {
        throw Exception('No app could open it.');
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('The letter could not be opened.\n$e')),
        );
      }
    }
  }

  Future<void> _acknowledge(
      BuildContext context, WidgetRef ref, Warning warning) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Confirm you have seen this'),
        content: const Text(
          'This records that it was shown to you and when. It is not agreement '
          'with it, and it does not stop you responding.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('I have seen it'),
          ),
        ],
      ),
    );
    if (sure != true) return;
    try {
      await ref.read(hrRepositoryProvider).acknowledgeWarning(warning.id);
      ref.invalidate(myWarningsProvider);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('That did not save.\n$e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final warnings = ref.watch(myWarningsProvider);
    final fmt = DateFormat('d MMM yyyy');

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(myWarningsProvider),
      child: warnings.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(children: const [
          SizedBox(height: 60),
          _Message(
            icon: Icons.wifi_off_outlined,
            title: 'This needs a connection',
            body: 'Your file is not kept on the phone.',
          ),
        ]),
        data: (rows) => rows.isEmpty
            ? ListView(children: const [
                SizedBox(height: 60),
                _Message(
                  icon: Icons.verified_outlined,
                  title: 'Nothing on your file',
                  body: 'No warnings have been issued to you.',
                ),
              ])
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  for (final w in rows)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              w.warningType.replaceAll('_', ' '),
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Issued ${fmt.format(w.issuedOn)}'
                              '${w.expiresOn != null ? ' · lapses ${fmt.format(w.expiresOn!)}' : ''}',
                              style: const TextStyle(
                                  color: AppColors.textMuted, fontSize: 12),
                            ),
                            const SizedBox(height: 8),
                            Text(w.reason),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                if (w.documentPath != null)
                                  TextButton.icon(
                                    onPressed: () =>
                                        _open(context, ref, w.documentPath!),
                                    icon: const Icon(Icons.description_outlined,
                                        size: 16),
                                    label: const Text('Read the letter'),
                                  ),
                                const Spacer(),
                                if (w.acknowledged)
                                  Text(
                                    'Seen ${fmt.format(w.acknowledgedAt!)}',
                                    style: const TextStyle(
                                        color: AppColors.success,
                                        fontSize: 12),
                                  )
                                else
                                  FilledButton(
                                    onPressed: () =>
                                        _acknowledge(context, ref, w),
                                    child: const Text('I have seen it'),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          color: AppColors.textPrimary,
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(title,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 16)),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
