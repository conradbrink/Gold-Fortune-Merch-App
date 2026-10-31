import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_update.dart';
import '../../core/distribution.dart';
import '../open_link.dart';
import 'move_to_tickd.dart';

/// Wraps the whole app and reacts to [appUpdateProvider].
///
/// Three states, in order of severity:
///
///   * required — replaces the app entirely. Sits outside the router on
///     purpose so there is no screen, including login, that gets around it.
///   * optional — a dismissible strip above the current screen. Deliberately
///     not a dialog: a modal on launch is dismissed reflexively, and it would
///     land on top of whatever a rep was doing when the check resolved.
///   * neither — renders the app untouched.
class AppUpdateGate extends ConsumerWidget {
  const AppUpdateGate({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Falls through to `null` while the check is in flight and if it threw, so
    // the app renders normally in both cases. Nothing here is worth putting a
    // spinner in front of a rep trying to start their day.
    final update = ref.watch(appUpdateProvider).maybeWhen(
          data: (value) => value,
          orElse: () => null,
        );

    if (update == null) return child;

    // The old-id build once Tickd is out: a move, not an update.
    if (update.requirement == UpdateRequirement.moveToTickd) {
      return MoveToTickdGate(child: child);
    }

    if (update.requirement == UpdateRequirement.required) {
      return _ForcedUpdateScreen(update: update);
    }

    return Column(
      children: [
        _UpdateBanner(update: update),
        Expanded(child: child),
      ],
    );
  }
}

/// Opens where this build's updates come from: the download page for the APK,
/// or the store listing for a store build (core/distribution.dart).
Future<void> _openUpdatePage(BuildContext context) =>
    openFirstLink(context, updateLinksFor(distributionChannel));

class _UpdateBanner extends ConsumerWidget {
  const _UpdateBanner({required this.update});

  final AppUpdateInfo update;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Material(
      color: theme.colorScheme.secondaryContainer,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
          child: Row(
            children: [
              Icon(
                Icons.system_update,
                size: 20,
                color: theme.colorScheme.onSecondaryContainer,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Version ${update.versionName} is available',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSecondaryContainer,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              TextButton(
                onPressed: () => _openUpdatePage(context),
                child: const Text('Update'),
              ),
              IconButton(
                tooltip: 'Later',
                icon: const Icon(Icons.close, size: 18),
                onPressed: () => postponeUpdate(ref, update.versionCode),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ForcedUpdateScreen extends StatelessWidget {
  const _ForcedUpdateScreen({required this.update});

  final AppUpdateInfo update;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(
                  Icons.system_update,
                  size: 56,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(height: 20),
                Text(
                  'Update required',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                Text(
                  'This version of the app can no longer be used. '
                  'Install version ${update.versionName} to carry on working.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 12),
                // Said explicitly because the fear this screen creates is
                // "have I just lost this morning's visits?".
                Text(
                  'Anything already saved on this phone is kept and will sync '
                  'once you have updated.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: () => _openUpdatePage(context),
                  icon: const Icon(Icons.download),
                  label: Text(updateButtonLabelFor(distributionChannel)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
