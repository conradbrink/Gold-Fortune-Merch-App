import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/product.dart';
import 'package:gf_merch_rep/core/theme.dart';

/// The theme is built from the company's two colours (Stage 3). Gold Fortune's
/// navy and gold must produce exactly the app it has always had; any other pair
/// must reach every place the old constants were hard-coded.
void main() {
  const navy = Color(0xFF16224F);
  const gold = Color(0xFFE0B84B);

  group('buildAppTheme', () {
    test('Gold Fortune\'s colours give the theme it always had', () {
      final theme = buildAppTheme(navy, gold);
      expect(theme.colorScheme.primary, navy);
      expect(theme.colorScheme.secondary, gold);
      expect(theme.appBarTheme.backgroundColor, navy);
      expect(theme.appBarTheme.foregroundColor, Colors.white);
      expect(
        theme.elevatedButtonTheme.style!.backgroundColor!.resolve({}),
        navy,
      );
      expect(
        theme.outlinedButtonTheme.style!.foregroundColor!.resolve({}),
        navy,
      );
      final focused =
          theme.inputDecorationTheme.focusedBorder as OutlineInputBorder;
      expect(focused.borderSide.color, navy);
      expect(theme.scaffoldBackgroundColor, AppColors.background);
      expect(theme.colorScheme.error, AppColors.danger);
    });

    test('carries the brand colours for widgets to read by name', () {
      final brand = buildAppTheme(navy, gold).extension<BrandColors>()!;
      expect(brand.primary, navy);
      expect(brand.accent, gold);
      // The badge digit's shade: the old hard-coded #0F1836 to within one
      // step in one channel, which no eye can tell apart.
      final dark = brand.primaryDark;
      expect((dark.r * 255).round(), 0x0F);
      expect((dark.g * 255).round(), 0x18);
      expect(((dark.b * 255).round() - 0x36).abs(), lessThanOrEqualTo(1));
    });

    test('another company\'s colours reach the same places', () {
      const primary = Color(0xFF7C2D12);
      const accent = Color(0xFF22C55E);
      final theme = buildAppTheme(primary, accent);
      expect(theme.colorScheme.primary, primary);
      expect(theme.colorScheme.secondary, accent);
      expect(theme.appBarTheme.backgroundColor, primary);
      expect(theme.extension<BrandColors>()!.accent, accent);
    });

    test('status colours do not follow the company', () {
      final a = buildAppTheme(navy, gold);
      final b = buildAppTheme(kProductPrimary, kProductAccent);
      expect(a.colorScheme.error, b.colorScheme.error);
      expect(a.dividerTheme.color, b.dividerTheme.color);
    });
  });

  testWidgets('a widget outside the app theme gets the product palette',
      (tester) async {
    late BrandColors seen;
    await tester.pumpWidget(MaterialApp(
      home: Builder(builder: (context) {
        seen = context.brand;
        return const SizedBox.shrink();
      }),
    ));
    expect(seen.primary, kProductPrimary);
    expect(seen.accent, kProductAccent);
  });

  testWidgets('a widget inside it gets the company\'s', (tester) async {
    late BrandColors seen;
    await tester.pumpWidget(MaterialApp(
      theme: buildAppTheme(navy, gold),
      home: Builder(builder: (context) {
        seen = context.brand;
        return const SizedBox.shrink();
      }),
    ));
    expect(seen.primary, navy);
    expect(seen.accent, gold);
  });
}
