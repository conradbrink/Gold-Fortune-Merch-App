import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart'; // StateProvider moved here in Riverpod 3
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_client.dart';
import '../data/models/profile.dart';
import '../data/models/route_visit.dart';
import '../data/models/store_summary.dart';
import '../data/models/form_template.dart';
import '../data/models/lead.dart';
import '../data/models/promotion.dart';
import '../data/local/app_database.dart';
import '../data/repositories/file_repository.dart';
import '../data/repositories/form_repository.dart';
import '../data/repositories/lead_repository.dart';
import '../data/repositories/promotion_repository.dart';
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
///
/// Cached locally per user: check-in, check-out and form submission all need
/// the org id, so a null profile after an offline app restart silently
/// disables every rep action — the buttons look live but their handlers bail.
final profileProvider = FutureProvider<Profile?>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null) return null;

  final db = ref.watch(appDatabaseProvider);
  final cacheKey = 'profile:${user.id}';

  try {
    final row = await supabase
        .from('profiles')
        .select()
        .eq('id', user.id)
        .maybeSingle();

    if (row == null) return null;
    await db.setValue(cacheKey, jsonEncode(row));
    return Profile.fromMap(row);
  } catch (_) {
    final raw = await db.getValue(cacheKey);
    if (raw == null) rethrow;
    return Profile.fromMap(jsonDecode(raw) as Map<String, dynamic>);
  }
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

final fileRepositoryProvider = Provider<FileRepository>((ref) {
  return FileRepository(supabase, ref.watch(appDatabaseProvider));
});

/// Shared documents this rep may see. Metadata only — nothing downloads until
/// the rep taps a file.
final filesProvider = FutureProvider<List<CachedFile>>((ref) {
  return ref.watch(fileRepositoryProvider).fetchFiles();
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

final leadRepositoryProvider = Provider<LeadRepository>((ref) {
  return LeadRepository(
    ref.watch(appDatabaseProvider),
    ref.watch(syncEngineProvider),
  );
});

/// The rep's own sales calls, open ones first. Read from the local cache, so
/// it is the same list with or without signal.
final myLeadsProvider = FutureProvider<List<Lead>>((ref) async {
  return ref.watch(leadRepositoryProvider).myLeads();
});

final promotionRepositoryProvider = Provider<PromotionRepository>((ref) {
  return PromotionRepository(
    supabase,
    ref.watch(appDatabaseProvider),
    ref.watch(syncEngineProvider),
  );
});

/// Every promotion live today, for the whole org. Fetched once and filtered per
/// store in memory — see the note in `PromotionRepository.fetchLivePromotions`
/// for why this is not a per-store query.
final livePromotionsProvider = FutureProvider<List<Promotion>>((ref) async {
  return ref.watch(promotionRepositoryProvider).fetchLivePromotions();
});

/// Answers already given at a store, keyed `promotionId:productId`. Keyed by
/// "storeId|visitClientId" because whether an answer belongs to *this* visit is
/// part of the result.
final promotionAnswersProvider =
    FutureProvider.family<Map<String, PromotionAnswer>, String>((ref, key) {
  final parts = key.split('|');
  return ref.watch(promotionRepositoryProvider).answersForStore(
        storeId: parts[0],
        visitClientGeneratedId: parts.length > 1 ? parts[1] : '',
      );
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

/// Month-to-date completion against the rep's schedule, for the day-plan and
/// workday-summary screens (cached copy when offline).
final monthlyCompletionProvider =
    FutureProvider.autoDispose<MonthlyCompletion?>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null) return null;
  return ref.watch(routeRepositoryProvider).fetchMonthlyCompletion(user.id);
});

/// Active stores for the unscheduled-visit picker. Cached for offline use.
final storesProvider = FutureProvider<List<StoreSummary>>((ref) async {
  return ref.watch(routeRepositoryProvider).fetchStores();
});

final todayRoutesProvider = FutureProvider<List<RouteVisit>>((ref) async {
  final user = ref.watch(currentUserProvider);
  final date = ref.watch(selectedRouteDateProvider);
  if (user == null) return [];

  final repo = ref.watch(routeRepositoryProvider);
  return repo.fetchRoutesForDate(user.id, date);
});
