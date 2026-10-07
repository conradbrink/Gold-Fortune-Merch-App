// Smoke test for the login screen. Deliberately avoids booting the real
// Supabase client (which needs network) — it only checks that the screen
// renders its basic controls, and whose name it wears.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gf_merch_rep/core/branding.dart';
import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/product.dart';
import 'package:gf_merch_rep/core/terms.dart';
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

  // A phone that has never signed in cannot know whose app it is, so it is
  // the product's.
  testWidgets('before any sign-in it shows the product', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: LoginScreen()),
      ),
    );

    expect(find.text(kProductName), findsOneWidget);
    expect(
      find.byWidgetPredicate((w) =>
          w is Image &&
          w.image is AssetImage &&
          (w.image as AssetImage).assetName == kProductMarkAsset),
      findsOneWidget,
    );
  });

  // After a first sign-in the last company's own name takes over, from the
  // phone's cache — and never the product mark beside it.
  testWidgets('after a sign-in it shows the last company', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          companyLookProvider.overrideWithValue((
            orgId: 'org-1',
            terms: Terms.defaults,
            branding: const Branding(
              name: 'Gold Fortune',
              logoPath: 'org-1/logo.png',
              primary: Color(0xFF16224F),
              accent: Color(0xFFE0B84B),
            ),
          )),
          // The logo has not been downloaded: the name stands alone.
          companyLogoProvider.overrideWith((ref) async => null),
        ],
        child: const MaterialApp(home: LoginScreen()),
      ),
    );
    await tester.pump();

    expect(find.text('Gold Fortune'), findsOneWidget);
    expect(find.text(kProductName), findsNothing);
    expect(find.byType(Image), findsNothing);
  });
}
