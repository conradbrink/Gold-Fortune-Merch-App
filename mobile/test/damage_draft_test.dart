// An unfinished damage report is kept per visit by its screen, with the photo
// the rep took. These tests hold the two ways it ends: queued (the draft goes
// in the same write, the photo stays for the report), or abandoned (dropped
// with its photo once nobody can come back to it).
import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/repositories/order_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';

/// `reportDamage` ends with `unawaited(_sync.sync())`; here that does nothing.
class _SilentSync extends SyncEngine {
  _SilentSync(AppDatabase db) : super(db, SupabaseClient('http://localhost:1', 'test-anon-key'));

  @override
  Future<void> sync() async {}
}

void main() {
  late AppDatabase db;
  late OrderRepository repo;
  late Directory dir;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    repo = OrderRepository(SupabaseClient('http://localhost:1', 'test-anon-key'), db, _SilentSync(db));
    dir = Directory.systemTemp.createTempSync('damage_draft_test');
  });

  tearDown(() async {
    await db.close();
    dir.deleteSync(recursive: true);
  });

  final now = DateTime(2026, 10, 15, 12);

  Future<File> keepDraft(String visit, DateTime savedAt) async {
    final photo = File('${dir.path}/$visit.jpg')..writeAsBytesSync([1, 2, 3]);
    await db.setValue(
      OrderRepository.damageDraftKey(visit),
      jsonEncode({'what': 'p1', 'qty': 2, 'photo_path': photo.path, 'saved_at': savedAt.toIso8601String()}),
    );
    return photo;
  }

  test('reporting the damage clears the draft in the same write, and keeps the photo', () async {
    final photo = await keepDraft('visit-1', now);

    await repo.reportDamage(
      orgId: 'org-1',
      repId: 'rep-1',
      storeId: 'store-1',
      visitClientGeneratedId: 'visit-1',
      productId: 'p1',
      label: 'Cooking oil 2L',
      qty: 2,
      photo: (file: photo, clientId: 'photo-1'),
    );

    expect(await db.getValue(OrderRepository.damageDraftKey('visit-1')), isNull);
    expect(photo.existsSync(), isTrue, reason: 'the queued report still needs it');
    final payload = jsonDecode((await db.pendingEntries()).single.payload) as Map<String, dynamic>;
    expect(payload['local_photo_path'], photo.path);
  });

  test("a checked-out visit's draft goes with its photo; a fresh one elsewhere stays", () async {
    final ended = await keepDraft('visit-ended', now);
    final other = await keepDraft('visit-other', now.subtract(const Duration(hours: 2)));

    await repo.dropDamageDrafts(visit: 'visit-ended', now: now);

    expect(await db.getValue(OrderRepository.damageDraftKey('visit-ended')), isNull);
    expect(ended.existsSync(), isFalse);
    expect(await db.getValue(OrderRepository.damageDraftKey('visit-other')), isNotNull);
    expect(other.existsSync(), isTrue);
  });

  test('a draft left for more than a week goes, and so does an unreadable one', () async {
    final old = await keepDraft('visit-old', now.subtract(const Duration(days: 8)));
    await db.setValue(OrderRepository.damageDraftKey('visit-broken'), 'not json');
    // `like` would match this (`_` is any character); it is not a draft.
    await db.setValue('damage-draft:visit-x', 'x');

    await repo.dropDamageDrafts(now: now);

    expect(await db.getValue(OrderRepository.damageDraftKey('visit-old')), isNull);
    expect(old.existsSync(), isFalse);
    expect(await db.getValue(OrderRepository.damageDraftKey('visit-broken')), isNull);
    expect(await db.getValue('damage-draft:visit-x'), 'x');
  });
}
