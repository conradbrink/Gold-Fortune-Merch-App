import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/company_config.dart';
import '../../core/theme.dart';
import 'auth_controller.dart';

/// Shown if a manager account signs in on the mobile app — managers use the
/// web dashboard; this app is for the field team only.
class ManagerNoticeScreen extends ConsumerWidget {
  const ManagerNoticeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(termsProvider);
    final company = ref.watch(brandingProvider).name;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: context.brand.accent.withValues(alpha: 0.18),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.laptop_mac_outlined,
                      color: context.brand.primary, size: 30),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Use the web dashboard',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Managers and warehouse staff work from the '
                  '${company == null ? '' : '$company '}web dashboard — '
                  '${t.site.manyLower}, schedules and forms for one, orders '
                  'and stock for the other. This mobile app is for field '
                  '${t.staff.manyLower}.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 14),
                ),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () =>
                      ref.read(authControllerProvider.notifier).signOut(),
                  child: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
