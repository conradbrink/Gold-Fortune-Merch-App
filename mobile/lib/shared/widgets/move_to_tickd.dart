import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/company_config.dart';
import '../../core/env.dart';
import '../../core/move_to_tickd.dart';
import '../../core/product.dart';
import '../../core/providers.dart';
import '../../features/workday/workday_controller.dart';

/// The old app's last job: moving its rep to Tickd without losing anything.
///
/// Shown only by the old-id build once Tickd is out (core/move_to_tickd.dart).
/// A strip above every screen, never a lock: the rep may still have a day to
/// finish in this app, and the work it holds can only leave from here. The
/// strip opens a checklist whose order is the point — the old app is removed
/// last, and only once nothing is waiting to sync, because Tickd starts empty
/// and anything still queued here would be lost with it.
class MoveToTickdGate extends StatefulWidget {
  const MoveToTickdGate({super.key, required this.child});

  final Widget child;

  @override
  State<MoveToTickdGate> createState() => _MoveToTickdGateState();
}

class _MoveToTickdGateState extends State<MoveToTickdGate> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    if (_open) return MoveToTickdScreen(onClose: () => setState(() => _open = false));
    return Column(
      children: [
        _MoveBanner(onOpen: () => setState(() => _open = true)),
        Expanded(child: widget.child),
      ],
    );
  }
}

class _MoveBanner extends StatelessWidget {
  const _MoveBanner({required this.onOpen});

  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.secondaryContainer,
      child: SafeArea(
        bottom: false,
        child: InkWell(
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Row(
              children: [
                Icon(Icons.swap_horiz, size: 20, color: theme.colorScheme.onSecondaryContainer),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'This app is moving to $kProductName',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSecondaryContainer,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                TextButton(onPressed: onOpen, child: const Text('How to move')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class MoveToTickdScreen extends ConsumerStatefulWidget {
  const MoveToTickdScreen({super.key, required this.onClose});

  final VoidCallback onClose;

  @override
  ConsumerState<MoveToTickdScreen> createState() => _MoveToTickdScreenState();
}

class _MoveToTickdScreenState extends ConsumerState<MoveToTickdScreen> {
  bool _syncing = false;

  Future<void> _syncNow() async {
    setState(() => _syncing = true);
    try {
      await ref.read(syncEngineProvider).sync();
    } catch (_) {
      // The count below stays put and says what is left; the sync engine
      // keeps retrying on its own.
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  Future<void> _openDownload() async {
    // A compile-time URL, never one from the server (see AppUpdateGate).
    final ok = await launchUrl(Uri.parse(Env.downloadPageUrl), mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open the browser. Go to ${Env.downloadPageUrl}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = ref.watch(termsProvider);
    final pending = ref.watch(pendingSyncCountProvider).maybeWhen(data: (n) => n, orElse: () => null);
    final session = ref.watch(workdayControllerProvider).maybeWhen(data: (s) => s, orElse: () => null);
    final dayOpen = session != null && session.endedAt == null;
    final allSent = pending == 0;
    final readyToRemove = readyToRemoveOldApp(dayOpen: dayOpen, pending: pending);

    return Scaffold(
      appBar: AppBar(
        title: Text('Move to $kProductName'),
        leading: IconButton(icon: const Icon(Icons.close), tooltip: 'Not now', onPressed: widget.onClose),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              '$kProductName replaces this app. Moving takes a few minutes. '
              'Do it in this order, so nothing you have recorded is lost.',
              style: theme.textTheme.bodyLarge,
            ),
            const SizedBox(height: 20),
            _Step(
              number: 1,
              done: !dayOpen,
              title: 'End your ${t.workday.oneLower} in this app',
              detail: dayOpen
                  ? 'Your ${t.workday.oneLower} is still open here. End it before you move.'
                  : 'Nothing is open.',
            ),
            _Step(
              number: 2,
              done: allSent,
              title: 'Send everything to the office',
              detail: pending == null
                  ? 'Checking…'
                  : allSent
                      ? 'Everything has been sent.'
                      : '$pending ${pending == 1 ? 'change is' : 'changes are'} still on this phone. '
                          'Connect to the internet and tap Send now.',
              action: allSent
                  ? null
                  : FilledButton.tonal(
                      onPressed: _syncing ? null : _syncNow,
                      child: Text(_syncing ? 'Sending…' : 'Send now'),
                    ),
            ),
            _Step(
              number: 3,
              done: false,
              title: 'Install $kProductName',
              detail: 'Download it and install it. It appears beside this app as "$kProductName".',
              action: FilledButton(onPressed: _openDownload, child: Text('Download $kProductName')),
            ),
            _Step(
              number: 4,
              done: false,
              title: 'Sign in to $kProductName',
              detail: 'Use the same email and password as here.',
            ),
            _Step(
              number: 5,
              done: false,
              title: 'Then remove this app',
              detail: readyToRemove
                  ? 'Once you have signed in to $kProductName, remove this one: press and hold '
                      '"$kProductName (old)" on your home screen and choose Uninstall.'
                  : 'Not yet. Finish steps 1 and 2 first: removing this app now would delete '
                      'what has not been sent.',
              warning: !readyToRemove,
            ),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: widget.onClose, child: const Text('Not now')),
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({
    required this.number,
    required this.done,
    required this.title,
    required this.detail,
    this.action,
    this.warning = false,
  });

  final int number;
  final bool done;
  final String title;
  final String detail;
  final Widget? action;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: done ? scheme.primary : scheme.surfaceContainerHighest,
            child: done
                ? Icon(Icons.check, size: 16, color: scheme.onPrimary)
                : Text('$number', style: theme.textTheme.labelLarge),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(
                  detail,
                  style: theme.textTheme.bodyMedium?.copyWith(color: warning ? scheme.error : null),
                ),
                if (action != null) ...[const SizedBox(height: 8), action!],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
