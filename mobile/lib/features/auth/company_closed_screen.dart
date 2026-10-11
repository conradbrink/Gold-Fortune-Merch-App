import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/company_closed.dart';
import '../../core/product.dart';
import '../../core/providers.dart';
import '../../core/supabase_client.dart';
import '../../core/theme.dart';
import 'auth_controller.dart';

/// Shown when the person's company has been closed from the Control Centre.
/// Nothing in the app works for them until it is reopened; "Try again" asks
/// the database afresh, for the moment it is.
class CompanyClosedScreen extends ConsumerStatefulWidget {
  const CompanyClosedScreen({super.key});

  @override
  ConsumerState<CompanyClosedScreen> createState() => _CompanyClosedScreenState();
}

class _CompanyClosedScreenState extends ConsumerState<CompanyClosedScreen> {
  bool _checking = false;

  Future<void> _tryAgain() async {
    final userId = supabase.auth.currentUser?.id;
    if (userId == null) return;
    setState(() => _checking = true);
    final closed = await refreshCompanyClosed(ref.read(appDatabaseProvider), userId);
    if (!mounted) return;
    setState(() => _checking = false);
    if (!closed) {
      context.go('/');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Still closed.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
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
                  child: Icon(Icons.lock_outline, color: context.brand.primary, size: 30),
                ),
                const SizedBox(height: 20),
                const Text(
                  'Your company\'s $kProductName account is closed',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'You can\'t use $kProductName for this company at the moment. '
                  'Nothing has been deleted. If you think this is a mistake, '
                  'ask the person who runs your company.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.textMuted, fontSize: 14),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _checking ? null : _tryAgain,
                  child: Text(_checking ? 'Checking…' : 'Try again'),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
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
