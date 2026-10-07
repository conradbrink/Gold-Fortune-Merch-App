import 'package:flutter/material.dart';

import 'product.dart';

/// Colours that do not change with the company: surfaces, text, and the status
/// colours (red reserved for destructive and missed states), which have to
/// mean the same thing in every company's app. The company's own two colours
/// live in the theme instead — see [BrandColors].
class AppColors {
  static const background = Color(0xFFF7F8FA);
  static const surface = Color(0xFFFFFFFF);
  static const border = Color(0xFFE3E6EC);
  static const textPrimary = Color(0xFF1A2138);
  static const textMuted = Color(0xFF6B7280);
  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);
  static const info = Color(0xFF3B82F6);
}

/// The company's colours, carried on the theme so a widget can ask for them by
/// name rather than hard-coding one company's navy and gold.
///
/// `colorScheme.primary` and `.secondary` hold the same two colours; this adds
/// the darker shade the badges use, and keeps the names the screens were
/// written against.
@immutable
class BrandColors extends ThemeExtension<BrandColors> {
  const BrandColors({
    required this.primary,
    required this.primaryDark,
    required this.accent,
  });

  factory BrandColors.from(Color primary, Color accent) => BrandColors(
        primary: primary,
        // Badge text on the accent. Derived rather than chosen so a company
        // sets two colours, not three.
        primaryDark: Color.lerp(primary, Colors.black, 0.3)!,
        accent: accent,
      );

  /// Headers, app bar, primary buttons.
  final Color primary;
  final Color primaryDark;

  /// Highlights: badges, rewards, the unscheduled marker.
  final Color accent;

  /// The product palette, for a widget built outside the app's theme (a test,
  /// a dialog with its own `Theme`).
  static final product = BrandColors.from(kProductPrimary, kProductAccent);

  static BrandColors of(BuildContext context) =>
      Theme.of(context).extension<BrandColors>() ?? product;

  @override
  BrandColors copyWith({Color? primary, Color? primaryDark, Color? accent}) =>
      BrandColors(
        primary: primary ?? this.primary,
        primaryDark: primaryDark ?? this.primaryDark,
        accent: accent ?? this.accent,
      );

  @override
  BrandColors lerp(BrandColors? other, double t) {
    if (other == null) return this;
    return BrandColors(
      primary: Color.lerp(primary, other.primary, t)!,
      primaryDark: Color.lerp(primaryDark, other.primaryDark, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
    );
  }
}

/// `context.brand.primary` — shorthand for [BrandColors.of].
extension BrandContext on BuildContext {
  BrandColors get brand => BrandColors.of(this);
}

/// The app's theme in a company's two colours.
///
/// Built from the configuration's `branding`, and rebuilt when it changes. With
/// Gold Fortune's navy and gold this is exactly the theme the app always had.
ThemeData buildAppTheme(Color primary, Color accent) {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: primary,
      primary: primary,
      secondary: accent,
      surface: AppColors.surface,
      error: AppColors.danger,
    ),
    scaffoldBackgroundColor: AppColors.background,
  );

  return base.copyWith(
    extensions: [BrandColors.from(primary, accent)],
    appBarTheme: AppBarTheme(
      backgroundColor: primary,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: primary,
        side: const BorderSide(color: AppColors.border),
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: primary, width: 1.5),
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.border),
      ),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
  );
}
