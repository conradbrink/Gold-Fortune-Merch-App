import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/env.dart';
import '../../features/auth/auth_controller.dart';
import '../open_link.dart';

enum _AccountAction { signOut, deleteAccount }

/// The menu at the end of a home screen's app bar: sign out, and how to delete
/// this login.
///
/// Both stores want a signed-in person to be able to find out how to delete
/// their account from inside the app. A login here is made by the company,
/// not in the app, so the link opens the website's page, which says to ask a
/// manager or email us.
class AccountMenu extends ConsumerWidget {
  const AccountMenu({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopupMenuButton<_AccountAction>(
      tooltip: 'More',
      onSelected: (action) {
        switch (action) {
          case _AccountAction.signOut:
            ref.read(authControllerProvider.notifier).signOut();
          case _AccountAction.deleteAccount:
            openFirstLink(context, [Uri.parse(Env.deleteAccountUrl)]);
        }
      },
      itemBuilder: (_) => const [
        PopupMenuItem(value: _AccountAction.signOut, child: Text('Sign out')),
        PopupMenuItem(
          value: _AccountAction.deleteAccount,
          child: Text('Delete my account'),
        ),
      ],
    );
  }
}
