import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/company_config.dart';
import 'workday_controller.dart';

/// Asks, then opens today's day again for a rep who ended it by mistake. True
/// once the day is open.
///
/// Asked first because a restart turns location recording back on and counts
/// the time in between as working time, and a stray tap should do neither.
/// Shared by the banner and the summary shown just after ending, which is
/// where a rep who tapped End by mistake finds out.
///
/// Says so when it cannot: past the cut-off (a screen left open can still
/// show the button), or when the restart fails. [reportErrors] is for a
/// caller with no listener of its own on the workday — the banner has one,
/// and would show a failure twice.
Future<bool> confirmRestartWorkday(
  BuildContext context,
  WidgetRef ref, {
  bool reportErrors = false,
}) async {
  final workday = ref.read(termsProvider).workday.oneLower;
  final autoEnd = ref.read(companyConfigValueProvider).autoEnd;
  final tooLate = autoEnd.enabled
      ? 'It is past ${autoEnd.label}, so your $workday cannot be restarted '
          'today.'
      : 'Your $workday cannot be restarted now.';

  void tell(String message) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));

  if (!ref.read(workdayControllerProvider.notifier).canRestart) {
    tell(tooLate);
    return false;
  }
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Restart your $workday?'),
      content: Text(
        'Your $workday carries on as if you had not ended it. The time in '
        'between counts as working time, and your location is recorded again.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text('Restart $workday'),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return false;

  // Read again: the controller is rebuilt while the question is open, and the
  // cut-off can pass.
  final controller = ref.read(workdayControllerProvider.notifier);
  final allowed = controller.canRestart;
  await controller.restartWorkday();
  final result = ref.read(workdayControllerProvider);
  if (result.value != null) return true;
  if (!context.mounted) return false;
  if (!allowed) {
    tell(tooLate);
  } else if (reportErrors && result.hasError) {
    tell('${result.error}');
  }
  return false;
}
