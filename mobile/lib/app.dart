import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/interrupted_location.dart';
import 'core/providers.dart';
import 'core/supabase_client.dart';
import 'core/theme.dart';
import 'data/local/app_database.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/manager_notice_screen.dart';
import 'features/files/files_screen.dart';
import 'features/orders/order_capture_route.dart';
import 'features/route_today/route_today_screen.dart';
import 'features/visit/store_detail_screen.dart';
import 'features/visit/sales_visit_complete_screen.dart';
import 'features/visit/sales_visit_start_screen.dart';
import 'features/visit/store_picker_screen.dart';
import 'features/visit/unscheduled_chooser_screen.dart';
import 'features/workday/day_plan_screen.dart';
import 'features/workday/workday_summary_screen.dart';
import 'shared/widgets/app_update_gate.dart';

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

/// Cache key for the signed-in user's role. Scoped by user id so signing in
/// as somebody else can never inherit the previous role.
String _roleKey(String userId) => 'role:$userId';

final routerProvider = Provider<GoRouter>((ref) {
  final db = ref.watch(appDatabaseProvider);

  /// Resolves the role without ever blocking navigation on the network.
  ///
  /// The redirect runs on every navigation, so a plain fetch here strands the
  /// rep on whatever screen they were on the moment they lose signal — which
  /// is exactly when they most need the app. Reads the cached role first and
  /// refreshes it in the background; only a user we've never seen falls back
  /// to a live fetch, and even that failing lets them through rather than
  /// trapping them.
  Future<String?> resolveRole(String userId) async {
    final cached = await db.getValue(_roleKey(userId));
    if (cached != null) {
      unawaited(_refreshRole(db, userId));
      return cached;
    }
    try {
      final row = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();
      final role = row?['role'] as String?;
      if (role != null) await db.setValue(_roleKey(userId), role);
      return role;
    } catch (_) {
      return null;
    }
  }

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
            // The chooser, not the store picker. 'unscheduled/store' is the
            // old destination, unchanged — a check-in at a shop already on the
            // estate still goes through exactly the same screen.
            path: 'unscheduled',
            builder: (context, state) => const UnscheduledChooserScreen(),
            routes: [
              GoRoute(
                path: 'store',
                builder: (context, state) => const StorePickerScreen(),
              ),
              GoRoute(
                path: 'sales',
                builder: (context, state) => const SalesVisitStartScreen(),
                routes: [
                  GoRoute(
                    path: ':clientId',
                    builder: (context, state) => SalesVisitCompleteScreen(
                      clientId: state.pathParameters['clientId']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          GoRoute(
            path: 'day-plan',
            builder: (context, state) => const DayPlanScreen(),
          ),
          GoRoute(
            path: 'files',
            builder: (context, state) => const FilesScreen(),
          ),
          GoRoute(
            path: 'workday-summary',
            builder: (context, state) {
              // Only reachable with the snapshot the banner hands over; a
              // stale deep link just goes home.
              final data = state.extra;
              if (data is! WorkdaySummaryData) {
                return const RouteTodayScreen();
              }
              return WorkdaySummaryScreen(data: data);
            },
          ),
          GoRoute(
            // Route id for a scheduled visit, or the visit's client id for an
            // unscheduled one — see RouteVisit.cacheKey.
            path: 'visit/:key',
            builder: (context, state) => StoreDetailScreen(
              visitKey: state.pathParameters['key']!,
            ),
            routes: [
              GoRoute(
                // A route rather than the `Navigator.push` this used to be.
                // An imperative push is invisible to go_router, so anything
                // that rebuilt the stack — a session blip, a redirect —
                // discarded a half-typed order without trace. As a route it
                // is part of the match list, and it is what
                // InterruptedLocation has to have in order to return anyone
                // to it.
                //
                // The visit is resolved from the day rather than passed in
                // `extra`, which does not survive being restored.
                path: 'order',
                builder: (context, state) => OrderCaptureRoute(
                  visitKey: state.pathParameters['key']!,
                ),
              ),
            ],
          ),
        ],
      ),
    ],
    redirect: (context, state) async {
      final session = supabase.auth.currentSession;
      final loggingIn = state.matchedLocation == '/login';

      if (session == null) {
        if (loggingIn) return null;
        // Not necessarily a sign-out. See InterruptedLocation.
        InterruptedLocation.remember(state.uri.toString());
        return '/login';
      }
      if (loggingIn) return InterruptedLocation.take() ?? '/';

      // A live session anywhere but the login screen means no sign-out is in
      // progress, whatever was expected. See InterruptedLocation.
      InterruptedLocation.noteSessionAlive();

      final role = await resolveRole(session.user.id);
      final onManagerNotice = state.matchedLocation == '/manager-notice';

      // An unknown role means we're offline and have never cached one. Let
      // the rep UI load; RLS, not routing, is the real access boundary.
      if (role == null) return onManagerNotice ? '/' : null;

      // Only a rep gets the rep UI. This used to read `role != 'manager'`,
      // which was exact while there were two roles and became wrong the moment
      // a third existed — a warehouse clerk would have been handed today's
      // route and a check-in button, and `visits_insert` only pins the row to
      // the caller, so the database would have accepted it.
      if (role != 'rep' && !onManagerNotice) return '/manager-notice';
      if (role == 'rep' && onManagerNotice) return '/';
      return null;
    },
  );
});

/// Keeps the cached role current after a role change on the server, without
/// ever making navigation wait for it.
Future<void> _refreshRole(AppDatabase db, String userId) async {
  try {
    final row = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
    final role = row?['role'] as String?;
    if (role != null) await db.setValue(_roleKey(userId), role);
  } catch (_) {
    // Offline or transient — the cached value stays authoritative.
  }
}

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
      // Wraps every route, so a forced update cannot be walked around by
      // navigating — including by staying on the login screen.
      builder: (context, child) =>
          AppUpdateGate(child: child ?? const SizedBox.shrink()),
    );
  }
}
