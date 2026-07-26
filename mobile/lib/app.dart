import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/supabase_client.dart';
import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/manager_notice_screen.dart';
import 'features/route_today/route_today_screen.dart';
import 'features/visit/store_detail_screen.dart';

/// Bridges Supabase's auth stream into a [Listenable] so go_router
/// re-evaluates its `redirect` callback on every sign-in/out/token event.
class GoRouterRefreshStream extends ChangeNotifier {
  GoRouterRefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _subscription = stream.asBroadcastStream().listen((_) => notifyListeners());
  }

  late final StreamSubscription<dynamic> _subscription;

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: GoRouterRefreshStream(supabase.auth.onAuthStateChange),
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/manager-notice',
        builder: (context, state) => const ManagerNoticeScreen(),
      ),
      GoRoute(
        path: '/',
        builder: (context, state) => const RouteTodayScreen(),
        routes: [
          GoRoute(
            path: 'visit/:routeId',
            builder: (context, state) => StoreDetailScreen(
              routeId: state.pathParameters['routeId']!,
            ),
          ),
        ],
      ),
    ],
    redirect: (context, state) async {
      final session = supabase.auth.currentSession;
      final loggingIn = state.matchedLocation == '/login';

      if (session == null) {
        return loggingIn ? null : '/login';
      }
      if (loggingIn) return '/';

      final row = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();
      final role = row?['role'] as String?;
      final onManagerNotice = state.matchedLocation == '/manager-notice';

      if (role == 'manager' && !onManagerNotice) return '/manager-notice';
      if (role != 'manager' && onManagerNotice) return '/';
      return null;
    },
  );
});

class GfMerchApp extends ConsumerWidget {
  const GfMerchApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Gold Fortune Merchandising',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      routerConfig: router,
    );
  }
}
