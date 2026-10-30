// A rep who ended today's workday by mistake opens it again (owner, 30 Oct
// 2026). The same day carries on: no second workday, the end and the
// reopening both queue and land in that order, and a day that is open again on
// the phone stays open whether or not the server has heard yet.
//
// A real `SupabaseClient` over a fake PostgREST, as in
// workday_pending_end_test.dart.

import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/branding.dart';
import 'package:gf_merch_rep/core/company_config.dart';
import 'package:gf_merch_rep/core/providers.dart';
import 'package:gf_merch_rep/core/terms.dart';
import 'package:gf_merch_rep/data/local/app_database.dart';
import 'package:gf_merch_rep/data/local/outbox_types.dart';
import 'package:gf_merch_rep/data/models/profile.dart';
import 'package:gf_merch_rep/data/models/workday_session.dart';
import 'package:gf_merch_rep/data/repositories/workday_repository.dart';
import 'package:gf_merch_rep/data/sync/sync_engine.dart';
import 'package:gf_merch_rep/features/workday/workday_banner.dart';
import 'package:gf_merch_rep/features/workday/workday_auto_end.dart';
import 'package:gf_merch_rep/features/workday/workday_controller.dart';
import 'package:gf_merch_rep/features/workday/workday_trail.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _json = {'content-type': 'application/json'};

void main() {
  late AppDatabase db;
  SupabaseClient? client;
  late List<http.Request> requests;

  final startedAt = DateTime.now().subtract(const Duration(hours: 2));
  WorkdaySession day({DateTime? started}) => WorkdaySession(
        id: 'session-1',
        clientGeneratedId: 'day-1',
        orgId: 'org-1',
        repId: 'rep-1',
        startedAt: started ?? startedAt,
        distanceMeters: 4200,
      );
  Map<String, dynamic> row({required bool open}) => {
        ...day().toMap(),
        'ended_at': open ? null : DateTime.now().toUtc().toIso8601String(),
      };

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    requests = [];
  });

  tearDown(() async {
    await client?.dispose();
    client = null;
    await db.close();
  });

  /// [answer] stands in for the server; null is no signal.
  WorkdayRepository repo(Object? Function(http.Request request)? answer) {
    client = SupabaseClient(
      'http://localhost:54321',
      'anon-key',
      httpClient: MockClient((request) async {
        requests.add(request);
        final body = answer?.call(request);
        if (answer == null) return http.Response('offline', 503, request: request);
        return http.Response(jsonEncode(body), 200, headers: _json, request: request);
      }),
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    );
    return WorkdayRepository(
      client!,
      db,
      SyncEngine(db, client!, readBuild: () async => null, signedInUser: () => null),
    );
  }

  Future<void> end(WorkdayRepository r, {bool automatic = false}) async {
    await r.cacheActiveSession(day());
    await r.endWorkday(
      orgId: 'org-1',
      repId: 'rep-1',
      session: day(),
      distanceMeters: 4200,
      endedAt: DateTime.now(),
      automatic: automatic,
    );
  }

  /// Answers the open-session lookup with the day open, or with nothing.
  Object? Function(http.Request) server({required bool open}) => (request) {
        final q = request.url.queryParameters;
        if (q['ended_at'] == 'is.null' && open) return [row(open: true)];
        return [];
      };

  group('ended on this phone', () {
    test('the rep\'s own end can be taken back, today', () async {
      final r = repo(null);
      await end(r);
      final ended = await r.endedToday('rep-1');
      expect(ended?.clientGeneratedId, 'day-1');
      expect(ended?.distanceMeters, 4200);
    });

    test('a day that ended itself cannot', () async {
      final r = repo(null);
      await end(r, automatic: true);
      expect(await r.endedToday('rep-1'), isNull);
    });

    test('yesterday\'s day cannot', () async {
      final r = repo(null);
      await r.endWorkday(
        orgId: 'org-1',
        repId: 'rep-1',
        session: day(started: DateTime.now().subtract(const Duration(days: 1))),
        distanceMeters: 0,
        endedAt: DateTime.now(),
      );
      expect(await r.endedToday('rep-1'), isNull);
    });
  });

  group('reopened with no signal', () {
    test('the day is open, the same day, and no longer closed for today', () async {
      final r = repo(null);
      await end(r);
      expect(await r.hasClosedWorkdayToday('rep-1'), isTrue);

      final reopened = await r.reopenWorkday(repId: 'rep-1', session: day());

      expect(reopened.clientGeneratedId, 'day-1');
      expect((await r.fetchActiveSession('rep-1'))?.clientGeneratedId, 'day-1');
      expect(await r.hasPendingEnd('day-1'), isFalse);
      expect(await r.hasClosedWorkdayToday('rep-1'), isFalse);
      expect(await r.endedToday('rep-1'), isNull);

      // Queued after the end, so it lands after it.
      final queued = (await db.pendingEntries())
          .where((e) => e.entityType != OutboxType.locationPing)
          .map((e) => e.entityType)
          .toList();
      expect(queued, [OutboxType.workdayEnd, OutboxType.workdayReopen]);
    });

    test('while the server still has it open, the queued end does not close it', () async {
      final r = repo(null);
      await end(r);
      await r.reopenWorkday(repId: 'rep-1', session: day());

      final online = repo(server(open: true));
      expect((await online.fetchActiveSession('rep-1'))?.clientGeneratedId, 'day-1');
    });

    test('once the server has the end but not the reopening, the phone\'s copy stands', () async {
      final r = repo(null);
      await end(r);
      await r.reopenWorkday(repId: 'rep-1', session: day());
      // The end has landed; the reopening has not.
      for (final e in await db.entriesFor(OutboxType.workdayEnd, 'day-1')) {
        await db.deleteEntry(e.id);
      }

      final online = repo(server(open: false));
      final open = await online.fetchActiveSession('rep-1');
      expect(open?.clientGeneratedId, 'day-1');
      expect(open?.distanceMeters, 4200);
    });

    test('ended again after reopening, the day is over', () async {
      final r = repo(null);
      await end(r);
      await r.reopenWorkday(repId: 'rep-1', session: day());
      await end(r);

      expect(await r.hasPendingEnd('day-1'), isTrue);
      final online = repo(server(open: true));
      expect(await online.fetchActiveSession('rep-1'), isNull);
    });
  });

  group('the replay', () {
    Future<void> queueReopen() async {
      final r = repo(null);
      await end(r);
      for (final e in await db.pendingEntries()) {
        await db.deleteEntry(e.id);
      }
      await r.reopenWorkday(repId: 'rep-1', session: day());
    }

    SyncEngine engine() =>
        SyncEngine(db, client!, readBuild: () async => null, signedInUser: () => 'rep-1');

    test('clears what the end wrote, on that day\'s row', () async {
      await queueReopen();
      await client!.dispose();
      repo((request) => [
            {'id': 'session-1'},
          ]);
      requests.clear();

      await engine().sync();

      expect(await db.pendingEntries(), isEmpty);
      final call = requests.single;
      expect(call.method, 'PATCH');
      expect(call.url.path, endsWith('/workday_sessions'));
      expect(call.url.queryParameters['client_generated_id'], 'eq.day-1');
      final body = jsonDecode(call.body) as Map<String, dynamic>;
      for (final column in [
        'ended_at',
        'end_lat',
        'end_lng',
        'duration_seconds',
        'auto_ended_at',
        'ended_by',
        'road_distance_meters',
        'road_distance_at',
        'road_distance_error',
      ]) {
        expect(body.containsKey(column), isTrue, reason: column);
        expect(body[column], isNull, reason: column);
      }
      // Hours and distance so far are left as they are.
      expect(body.containsKey('started_at'), isFalse);
      expect(body.containsKey('distance_meters'), isFalse);
    });

    test('a row that is not there yet is retried, not dropped', () async {
      await queueReopen();
      await client!.dispose();
      repo((request) => request.method == 'PATCH' ? [] : null);

      await engine().sync();

      final left = (await db.pendingEntries()).single;
      expect(left.entityType, OutboxType.workdayReopen);
      expect(left.attempts, 1);
    });
  });

  test('a day the office closed stays closed', () async {
    final r = repo(null);
    await end(r);
    for (final e in await db.pendingEntries()) {
      await db.deleteEntry(e.id);
    }
    await r.reopenWorkday(repId: 'rep-1', session: day());
    await client!.dispose();
    repo((request) => request.method == 'PATCH' ? [] : [{'id': 'session-1'}]);

    await SyncEngine(db, client!, readBuild: () async => null, signedInUser: () => 'rep-1').sync();

    expect(requests.first.url.queryParameters['ended_by'], 'is.null');
    expect(await db.pendingEntries(), isEmpty);
  });

  group('the controller', () {
    /// A day closed today on this phone, started at [started], under [rule].
    Future<(ProviderContainer, _ClosedRepo)> closed({
      required DateTime started,
      required AutoEndRule rule,
      bool endedHere = true,
    }) async {
      repo(null);
      final fake = _ClosedRepo(client!, db, ended: endedHere ? day(started: started) : null);
      final container = ProviderContainer(overrides: [
        currentUserProvider.overrideWithValue(const User(
          id: 'rep-1',
          appMetadata: {},
          userMetadata: {},
          aud: 'authenticated',
          createdAt: '2026-10-30T00:00:00Z',
        )),
        profileProvider.overrideWith(
          (ref) async => const Profile(id: 'rep-1', orgId: 'org-1', role: 'rep'),
        ),
        companyConfigValueProvider.overrideWithValue(CompanyConfig(
          modules: const {'core'},
          pingInterval: CompanyConfig.fallback.pingInterval,
          shortVisit: CompanyConfig.fallback.shortVisit,
          autoEnd: rule,
          checkinRadiusM: 100,
        )),
        brandingProvider.overrideWithValue(Branding.product),
        termsProvider.overrideWithValue(Terms.defaults),
        workdayRepositoryProvider.overrideWithValue(fake),
        syncEngineProvider.overrideWithValue(
          SyncEngine(db, client!, readBuild: () async => null, signedInUser: () => null),
        ),
        workdayTrailProvider.overrideWithValue(WorkdayTrail(
          currentMode: () async => LocationTrackingMode.background,
          openStream: (mode) => const Stream.empty(),
          lifecycleState: () => AppLifecycleState.resumed,
        )),
      ]);
      addTearDown(container.dispose);
      await container.read(profileProvider.future);
      await container.read(workdayControllerProvider.future);
      return (container, fake);
    }

    // Never past for a day started now: a start after 23:59 runs to
    // tomorrow's 23:59 (autoEndCutoffFor).
    const lateRule = AutoEndRule(enabled: true, hour: 23, minute: 59);

    test('offers a restart of the rep\'s own end, before the cut-off', () async {
      final (c, _) = await closed(started: DateTime.now(), rule: lateRule);
      final controller = c.read(workdayControllerProvider.notifier);
      expect(controller.isClosedForToday, isTrue);
      expect(controller.canRestart, isTrue);
    });

    test('not past the cut-off', () async {
      final (c, _) = await closed(
        started: DateTime(2026, 1, 1, 8),
        rule: const AutoEndRule(enabled: true, hour: 9, minute: 0),
      );
      expect(c.read(workdayControllerProvider.notifier).canRestart, isFalse);
    });

    test('any time, with auto-end switched off', () async {
      final (c, _) = await closed(
        started: DateTime(2026, 1, 1, 8),
        rule: const AutoEndRule(enabled: false, hour: 9, minute: 0),
      );
      expect(c.read(workdayControllerProvider.notifier).canRestart, isTrue);
    });

    test('not for a day this phone did not see the rep end', () async {
      final (c, _) = await closed(started: DateTime.now(), rule: lateRule, endedHere: false);
      expect(c.read(workdayControllerProvider.notifier).canRestart, isFalse);
    });

    test('restarting opens the same day and clears "finished for today"', () async {
      final (c, fake) = await closed(started: DateTime.now(), rule: lateRule);
      final controller = c.read(workdayControllerProvider.notifier);

      await controller.restartWorkday();

      expect(fake.reopened, 1);
      expect(c.read(workdayControllerProvider).value?.clientGeneratedId, 'day-1');
      expect(controller.isClosedForToday, isFalse);
      expect(controller.canRestart, isFalse);
    });

    test('past the cut-off, restarting does nothing', () async {
      final (c, fake) = await closed(
        started: DateTime(2026, 1, 1, 8),
        rule: const AutoEndRule(enabled: true, hour: 9, minute: 0),
      );
      await c.read(workdayControllerProvider.notifier).restartWorkday();
      expect(fake.reopened, 0);
      expect(c.read(workdayControllerProvider).value, isNull);
    });
  });

  test('a stalled end is taken back with the reopening, so the reopening can land', () async {
    final r = repo(null);
    await end(r);
    final queuedEnd = (await db.entriesFor(OutboxType.workdayEnd, 'day-1')).single;
    await db.recordFailure(queuedEnd.id, 8, 'refused');

    await r.reopenWorkday(repId: 'rep-1', session: day());

    expect(await db.entriesFor(OutboxType.workdayEnd, 'day-1'), isEmpty);
    expect(await db.entriesFor(OutboxType.workdayReopen, 'day-1'), hasLength(1));
  });

  group('the banner', () {
    Future<_ClosedDay> show(WidgetTester tester, {required bool canRestart}) async {
      final fake = _ClosedDay(canRestart: canRestart);
      await tester.pumpWidget(ProviderScope(
        overrides: [
          termsProvider.overrideWithValue(Terms.defaults),
          companyConfigValueProvider.overrideWithValue(CompanyConfig.fallback),
          workdayControllerProvider.overrideWith(() => fake),
        ],
        child: const MaterialApp(home: Scaffold(body: WorkdayBanner())),
      ));
      await tester.pump();
      return fake;
    }

    final workday = Terms.defaults.workday;

    testWidgets('offers a restart, and asks first', (tester) async {
      final fake = await show(tester, canRestart: true);

      expect(find.textContaining('Ended it by mistake?'), findsOneWidget);
      await tester.tap(find.text('Restart ${workday.oneLower}'));
      await tester.pumpAndSettle();
      expect(find.text('Restart your ${workday.oneLower}?'), findsOneWidget);
      expect(fake.restarts, 0);

      await tester.tap(find.widgetWithText(ElevatedButton, 'Restart ${workday.oneLower}'));
      await tester.pumpAndSettle();
      expect(fake.restarts, 1);
    });

    testWidgets('cancelled, nothing restarts', (tester) async {
      final fake = await show(tester, canRestart: true);
      await tester.tap(find.text('Restart ${workday.oneLower}'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(fake.restarts, 0);
    });

    testWidgets('no restart once it cannot be taken back', (tester) async {
      await show(tester, canRestart: false);
      expect(find.text('Restart ${workday.oneLower}'), findsNothing);
      expect(find.textContaining('can be started tomorrow'), findsOneWidget);
    });
  });
}

/// Today's day, closed by the rep; restarting is counted, not done.
class _ClosedDay extends WorkdayController {
  _ClosedDay({required this.canRestart});

  @override
  final bool canRestart;

  int restarts = 0;

  @override
  Future<WorkdaySession?> build() async => null;

  @override
  bool get isClosedForToday => true;

  @override
  LocationTrackingMode get trackingMode => LocationTrackingMode.background;

  @override
  Future<void> restartWorkday() async => restarts++;
}

/// Today's day, closed on this phone; reopening is counted, not queued.
class _ClosedRepo extends WorkdayRepository {
  _ClosedRepo(SupabaseClient client, AppDatabase db, {this.ended})
      : super(
          client,
          db,
          SyncEngine(db, client, readBuild: () async => null, signedInUser: () => null),
        );

  final WorkdaySession? ended;
  int reopened = 0;

  @override
  Future<WorkdaySession?> fetchActiveSession(String repId) async => null;

  @override
  Future<bool> hasClosedWorkdayToday(String repId) async => true;

  @override
  Future<WorkdaySession?> endedToday(String repId) async => ended;

  @override
  Future<WorkdaySession> reopenWorkday({
    required String repId,
    required WorkdaySession session,
  }) async {
    reopened++;
    return session;
  }
}
