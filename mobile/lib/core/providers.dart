import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart'; // StateProvider moved here in Riverpod 3
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_client.dart';
import '../data/models/profile.dart';
import '../data/models/route_visit.dart';
import '../data/models/form_template.dart';
import '../data/local/app_database.dart';
import '../data/repositories/form_repository.dart';
import '../data/repositories/route_repository.dart';
import '../data/repositories/visit_repository.dart';
import '../data/repositories/workday_repository.dart';
import '../data/sync/sync_engine.dart';

/// Fires on every sign-in/sign-out/token-refresh so downstream providers
/// (current user, profile) recompute automatically.
final authStateChangesProvider = StreamProvider<AuthState>((ref) {
  return supabase.auth.onAuthStateChange;
});

final currentUserProvider = Provider<User?>((ref) {
  final auth = ref.watch(authStateChangesProvider);
  return auth.maybeWhen(
    data: (state) => state.session?.user,
    orElse: () => supabase.auth.currentUser,
  );
});

/// The signed-in user's `profiles` row (org_id, role, full_name). Null when
/// signed out. Re-fetches whenever auth state changes.
final profileProvider = FutureProvider<Profile?>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null) return null;

  final row = await supabase
      .from('profiles')
      .select()
      .eq('id', user.id)
      .maybeSingle();

  if (row == null) return null;
  return Profile.fromMap(row);
});

/// Single long-lived local database for the whole app.
final appDatabaseProvider = Provider<AppDatabase>((ref) {
  ref.keepAlive();
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

final syncEngineProvider = Provider<SyncEngine>((ref) {
  ref.keepAlive();
  final engine = SyncEngine(ref.watch(appDatabaseProvider), supabase);
  engine.start();
  ref.onDispose(engine.dispose);
  return engine;
});

final syncStatusProvider = StreamProvider<SyncStatus>((ref) {
  return ref.watch(syncEngineProvider).status;
});

/// Number of operations still waiting to reach the server.
final pendingSyncCountProvider = StreamProvider<int>((ref) {
  return ref.watch(appDatabaseProvider).watchPendingCount();
});

final routeRepositoryProvider = Provider<RouteRepository>((ref) {
  return RouteRepository(supabase, ref.watch(appDatabaseProvider));
});

final workdayRepositoryProvider = Provider<WorkdayRepository>((ref) {
  return WorkdayRepository(
    supabase,
    ref.watch(appDatabaseProvider),
    ref.watch(syncEngineProvider),
  );
});

final visitRepositoryProvider = Provider<VisitRepository>((ref) {
  return VisitRepository(
    ref.watch(appDatabaseProvider),
    ref.watch(syncEngineProvider),
    ref.watch(workdayRepositoryProvider),
    ref.watch(routeRepositoryProvider),
  );
});

final formRepositoryProvider = Provider<FormRepository>((ref) {
  return FormRepository(
    supabase,
    ref.watch(appDatabaseProvider),
    ref.watch(syncEngineProvider),
  );
});

final formTemplatesProvider = FutureProvider<List<FormTemplate>>((ref) async {
  return ref.watch(formRepositoryProvider).fetchActiveTemplates();
});

/// Template IDs already submitted against a given visit.
final submittedTemplateIdsProvider =
    FutureProvider.family<Set<String>, String>((ref, visitId) async {
  return ref.watch(formRepositoryProvider).fetchSubmittedTemplateIds(visitId);
});

/// The date the "today" screen is showing. A plain state provider (not tied
/// to DateTime.now()) so a manual day-forward/back control can be added
/// later without changing callers.
final selectedRouteDateProvider = StateProvider<DateTime>((ref) {
  final now = DateTime.now();
  return DateTime(now.year, now.month, now.day);
});

final todayRoutesProvider = FutureProvider<List<RouteVisit>>((ref) async {
  final user = ref.watch(currentUserProvider);
  final date = ref.watch(selectedRouteDateProvider);
  if (user == null) return [];

  final repo = ref.watch(routeRepositoryProvider);
  return repo.fetchRoutesForDate(user.id, date);
});
