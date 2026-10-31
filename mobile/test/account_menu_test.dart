import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/env.dart';
import 'package:gf_merch_rep/shared/widgets/account_menu.dart';

/// The home screen's menu. Both stores want a signed-in person to find out how
/// to delete their login from inside the app; losing Sign out from it would
/// strand a rep on a shared phone.
void main() {
  testWidgets('the menu offers Sign out and Delete my account', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(appBar: AppBar(actions: const [AccountMenu()])),
        ),
      ),
    );

    await tester.tap(find.byTooltip('More'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Sign out'), findsOneWidget);
    expect(find.text('Delete my account'), findsOneWidget);
  });

  test('Delete my account opens the website page the stores are given', () {
    // The same address goes into both store listings
    // (docs/RELEASE-STORES.md); the app must not point somewhere else.
    expect(Env.deleteAccountUrl, 'https://tickd.co.za/delete-account');
  });
}
