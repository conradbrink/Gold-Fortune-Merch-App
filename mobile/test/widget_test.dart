// Smoke test for the login screen. Deliberately avoids booting the real
// Supabase client (which needs network) — it only checks that the screen
// renders its basic controls.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/features/auth/login_screen.dart';

void main() {
  testWidgets('LoginScreen renders email, password and sign in button',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginScreen()),
      ),
    );

    expect(find.text('Email'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.widgetWithText(ElevatedButton, 'Sign in'), findsOneWidget);
  });
}
