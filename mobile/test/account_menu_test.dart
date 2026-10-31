import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/env.dart';
import 'package:gf_merch_rep/features/auth/auth_controller.dart';
import 'package:gf_merch_rep/shared/widgets/account_menu.dart';

/// The home screen's menu. Both stores want a signed-in person to reach the
/// privacy policy and find out how to delete their login from inside the app;
/// losing Sign out from it would strand a rep on a shared phone.
class _RecordingAuth extends AuthController {
  int signOuts = 0;

  @override
  Future<void> signOut() async => signOuts++;
}

void main() {
  late _RecordingAuth auth;

  Future<void> openMenu(WidgetTester tester) async {
    auth = _RecordingAuth();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authControllerProvider.overrideWith(() => auth)],
        child: MaterialApp(
          home: Scaffold(appBar: AppBar(actions: const [AccountMenu()])),
        ),
      ),
    );
    await tester.tap(find.byTooltip('More'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

  testWidgets(
    'the menu offers Sign out, Privacy policy and Delete my account',
    (tester) async {
      await openMenu(tester);

      expect(find.text('Sign out'), findsOneWidget);
      expect(find.text('Privacy policy'), findsOneWidget);
      expect(find.text('Delete my account'), findsOneWidget);
    },
  );

  testWidgets('Sign out signs out', (tester) async {
    await openMenu(tester);

    await tester.tap(find.text('Sign out'));
    await tester.pump(const Duration(milliseconds: 300));

    expect(auth.signOuts, 1);
  });

  test('Privacy policy opens the policy the store listings link to', () {
    // Play Console's privacy policy is this address; the app must match it.
    expect(Env.privacyPolicyUrl, 'https://tickd.co.za/privacy');
  });

  test('Delete my account opens the website page the stores are given', () {
    // The same address goes into both store listings
    // (docs/RELEASE-STORES.md); the app must not point somewhere else.
    expect(Env.deleteAccountUrl, 'https://tickd.co.za/delete-account');
  });
}
