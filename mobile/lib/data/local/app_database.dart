import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

/// Pending writes captured on-device. Each row is one self-contained
/// operation replayed against Supabase when connectivity returns.
///
/// [clientGeneratedId] is the idempotency key — the server upserts on it, so
/// replaying an entry that actually succeeded before the ack was lost can
/// never create a duplicate.
class OutboxEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get entityType => text()();
  TextColumn get payload => text()(); // JSON
  TextColumn get clientGeneratedId => text()();
  DateTimeColumn get createdAt => dateTime()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
}

/// Local snapshot of the rep's route so the day's list renders with no
/// connection. Refreshed whenever a fetch succeeds.
class CachedRoutes extends Table {
  TextColumn get routeId => text()();
  TextColumn get scheduledDate => text()();
  TextColumn get payload => text()(); // JSON of the RouteVisit row
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {routeId};
}

@DriftDatabase(tables: [OutboxEntries, CachedRoutes])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

  // --- Outbox ---------------------------------------------------------

  Future<int> enqueue({
    required String entityType,
    required String payload,
    required String clientGeneratedId,
  }) {
    return into(outboxEntries).insert(
      OutboxEntriesCompanion.insert(
        entityType: entityType,
        payload: payload,
        clientGeneratedId: clientGeneratedId,
        createdAt: DateTime.now(),
      ),
    );
  }

  /// Oldest-first so operations replay in the order the rep performed them
  /// (a check-in must land before its check-out).
  Future<List<OutboxEntry>> pendingEntries({int limit = 50}) {
    return (select(outboxEntries)
          ..orderBy([(t) => OrderingTerm.asc(t.createdAt)])
          ..limit(limit))
        .get();
  }

  Stream<int> watchPendingCount() {
    final countExp = outboxEntries.id.count();
    final query = selectOnly(outboxEntries)..addColumns([countExp]);
    return query.map((row) => row.read(countExp) ?? 0).watchSingle();
  }

  Future<void> deleteEntry(int id) =>
      (delete(outboxEntries)..where((t) => t.id.equals(id))).go();

  /// Marks an attempt as failed so the engine can back off and the UI can
  /// surface entries that keep bouncing.
  Future<void> recordFailure(int id, int attempts, String error) {
    return (update(outboxEntries)..where((t) => t.id.equals(id))).write(
      OutboxEntriesCompanion(
        attempts: Value(attempts),
        lastError: Value(error),
      ),
    );
  }

  // --- Route cache ----------------------------------------------------

  Future<void> replaceCachedRoutes(
    String scheduledDate,
    List<({String routeId, String payload})> rows,
  ) async {
    await transaction(() async {
      await (delete(cachedRoutes)
            ..where((t) => t.scheduledDate.equals(scheduledDate)))
          .go();
      for (final row in rows) {
        await into(cachedRoutes).insertOnConflictUpdate(
          CachedRoutesCompanion.insert(
            routeId: row.routeId,
            scheduledDate: scheduledDate,
            payload: row.payload,
            cachedAt: DateTime.now(),
          ),
        );
      }
    });
  }

  Future<List<CachedRoute>> cachedRoutesForDate(String scheduledDate) {
    return (select(cachedRoutes)
          ..where((t) => t.scheduledDate.equals(scheduledDate)))
        .get();
  }

  Future<void> updateCachedRoute(String routeId, String payload) {
    return (update(cachedRoutes)..where((t) => t.routeId.equals(routeId)))
        .write(CachedRoutesCompanion(payload: Value(payload)));
  }
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'gf_merch.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
