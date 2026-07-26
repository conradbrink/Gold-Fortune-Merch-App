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

/// Local snapshot of the rep's day so the list renders with no connection.
/// Refreshed whenever a fetch succeeds.
///
/// Holds both scheduled visits and unscheduled ("ad-hoc") ones the rep started
/// themselves. [cacheKey] is the route id for a scheduled visit and the
/// visit's `client_generated_id` for an ad-hoc one, which has no route. It
/// keeps the original `route_id` column name so no rewrite migration is needed.
class CachedRoutes extends Table {
  TextColumn get cacheKey => text().named('route_id')();
  TextColumn get scheduledDate => text()();
  TextColumn get payload => text()(); // JSON of the RouteVisit row
  DateTimeColumn get cachedAt => dateTime()();

  /// Ad-hoc rows exist only on this device until they sync, so a schedule
  /// refresh must never delete them.
  BoolColumn get adHoc => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {cacheKey};
}

/// Small durable key/value store for things the app must know before it can
/// reach the network — currently the signed-in user's role, which routing
/// depends on and which would otherwise force a request on every navigation.
class KeyValueEntries extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

@DriftDatabase(tables: [OutboxEntries, CachedRoutes, KeyValueEntries])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 3;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.createTable(keyValueEntries);
          }
          if (from < 3) {
            await m.addColumn(cachedRoutes, cachedRoutes.adHoc);
          }
        },
      );

  // --- Key/value --------------------------------------------------------

  Future<String?> getValue(String key) async {
    final row = await (select(keyValueEntries)
          ..where((t) => t.key.equals(key)))
        .getSingleOrNull();
    return row?.value;
  }

  Future<void> setValue(String key, String value) {
    return into(keyValueEntries).insertOnConflictUpdate(
      KeyValueEntriesCompanion.insert(key: key, value: value),
    );
  }

  Future<void> deleteValue(String key) =>
      (delete(keyValueEntries)..where((t) => t.key.equals(key))).go();

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

  /// Replaces the *scheduled* rows for a date. Ad-hoc rows are left alone —
  /// they only exist here until they sync, so dropping them would lose an
  /// unscheduled visit the rep has already performed.
  Future<void> replaceCachedRoutes(
    String scheduledDate,
    List<({String cacheKey, String payload})> rows,
  ) async {
    await transaction(() async {
      await (delete(cachedRoutes)
            ..where((t) =>
                t.scheduledDate.equals(scheduledDate) & t.adHoc.equals(false)))
          .go();
      for (final row in rows) {
        await into(cachedRoutes).insertOnConflictUpdate(
          CachedRoutesCompanion.insert(
            cacheKey: row.cacheKey,
            scheduledDate: scheduledDate,
            payload: row.payload,
            cachedAt: DateTime.now(),
          ),
        );
      }
    });
  }

  Future<void> insertAdHocVisit({
    required String cacheKey,
    required String scheduledDate,
    required String payload,
  }) {
    return into(cachedRoutes).insertOnConflictUpdate(
      CachedRoutesCompanion.insert(
        cacheKey: cacheKey,
        scheduledDate: scheduledDate,
        payload: payload,
        cachedAt: DateTime.now(),
        adHoc: const Value(true),
      ),
    );
  }

  Future<List<CachedRoute>> cachedRoutesForDate(String scheduledDate) {
    return (select(cachedRoutes)
          ..where((t) => t.scheduledDate.equals(scheduledDate)))
        .get();
  }

  Future<List<CachedRoute>> adHocVisitsForDate(String scheduledDate) {
    return (select(cachedRoutes)
          ..where((t) =>
              t.scheduledDate.equals(scheduledDate) & t.adHoc.equals(true)))
        .get();
  }

  Future<void> updateCachedRoute(String cacheKey, String payload) {
    return (update(cachedRoutes)..where((t) => t.cacheKey.equals(cacheKey)))
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
