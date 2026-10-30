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
Future<bool> confirmRestartWorkday(BuildContext context, WidgetRef ref) async {
  final workday = ref.read(termsProvider).workday.oneLower;
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
  if (confirmed != true) return false;
  await ref.read(workdayControllerProvider.notifier).restartWorkday();
  return ref.read(workdayControllerProvider).value != null;
}
