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

/// Shared documents the manager has made visible to this rep.
///
/// Metadata is cached so the list renders with no connection, but the file
/// itself is only fetched when the rep taps it: they are on mobile data, and a
/// planogram that silently costs them a chunk of their bundle is a planogram
/// they will resent. [localPath] is null until that download happens, and is
/// what makes a cached copy openable in a shop with no signal.
class CachedFiles extends Table {
  TextColumn get fileId => text()();
  TextColumn get name => text()();
  TextColumn get description => text().nullable()();
  TextColumn get storagePath => text()();
  TextColumn get mimeType => text().nullable()();
  IntColumn get sizeBytes => integer().nullable()();
  TextColumn get localPath => text().nullable()();
  DateTimeColumn get updatedAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {fileId};
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

@DriftDatabase(tables: [OutboxEntries, CachedRoutes, KeyValueEntries, CachedFiles])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 4;

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
          if (from < 4) {
            await m.createTable(cachedFiles);
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
  ///
  /// [maxAttempts] leaves out entries that have already exhausted their retries.
  /// A drain must pass it: those entries are never deleted, so without it enough
  /// of them collect at the head of the queue to fill the whole `limit` window,
  /// and every newer operation behind them stops being looked at — the queue
  /// wedges permanently rather than skipping the poison. Callers that want the
  /// true backlog (the pending *count* the rep is shown) omit it.
  Future<List<OutboxEntry>> pendingEntries({int limit = 50, int? maxAttempts}) {
    final query = select(outboxEntries)
      ..orderBy([(t) => OrderingTerm.asc(t.createdAt)])
      ..limit(limit);
    if (maxAttempts != null) {
      query.where((t) => t.attempts.isSmallerThanValue(maxAttempts));
    }
    return query.get();
  }

  /// Client ids whose queued work has stopped being retried.
  ///
  /// Read separately from the drain window because the window no longer contains
  /// those entries, and anything queued *behind* one shares its client id and
  /// has to be held back with it. Without this a check-out could be replayed
  /// after its check-in had been given up on.
  Future<Set<String>> stalledClientIds(int maxAttempts) async {
    final query = selectOnly(outboxEntries, distinct: true)
      ..addColumns([outboxEntries.clientGeneratedId])
      ..where(outboxEntries.attempts.isBiggerOrEqualValue(maxAttempts));
    final rows = await query.get();
    return rows
        .map((r) => r.read(outboxEntries.clientGeneratedId))
        .whereType<String>()
        .toSet();
  }

  /// Client ids that still have queued work.
  ///
  /// A cached row carrying one of these holds local state the server has not
  /// been told about yet, so a refresh must not overwrite it with the server's
  /// older view. See `RouteRepository.fetchRoutesForDate`.
  Future<Set<String>> pendingClientIds() async {
    final query = selectOnly(outboxEntries, distinct: true)
      ..addColumns([outboxEntries.clientGeneratedId]);
    final rows = await query.get();
    return rows
        .map((r) => r.read(outboxEntries.clientGeneratedId))
        .whereType<String>()
        .toSet();
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

  // --- File cache -----------------------------------------------------

  /// Named `allCachedFiles` because drift already generates a `cachedFiles`
  /// getter for the table itself.
  Future<List<CachedFile>> allCachedFiles() {
    return (select(cachedFiles)..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]))
        .get();
  }

  /// Replaces the metadata list with what the server says this rep may see.
  ///
  /// Rows that disappear server-side are deleted, so a file the manager
  /// un-shared stops being listed. Any already-downloaded copy is deleted from
  /// disk by the caller — [localPath] is preserved for files that survive, so
  /// a refresh never forces a re-download.
  Future<void> replaceCachedFiles(List<CachedFilesCompanion> rows) async {
    await transaction(() async {
      final existing = {
        for (final f in await select(cachedFiles).get()) f.fileId: f.localPath,
      };
      final keep = rows.map((r) => r.fileId.value).toSet();

      await (delete(cachedFiles)..where((t) => t.fileId.isNotIn(keep.toList())))
          .go();

      for (final row in rows) {
        final held = existing[row.fileId.value];
        await into(cachedFiles).insertOnConflictUpdate(
          held == null ? row : row.copyWith(localPath: Value(held)),
        );
      }
    });
  }

  Future<void> setLocalPath(String fileId, String? localPath) {
    return (update(cachedFiles)..where((t) => t.fileId.equals(fileId)))
        .write(CachedFilesCompanion(localPath: Value(localPath)));
  }
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'gf_merch.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
