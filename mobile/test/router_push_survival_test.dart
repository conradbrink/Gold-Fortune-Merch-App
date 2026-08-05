// What happens to a half-typed order when the session blinks?
//
// Reps reported being thrown out of an order back to the day's list of shops,
// never having seen a login screen. Two things did that. Android reclaims the
// app on a 1 GB handset and the process restarts at `/` — nothing in software
// prevents that, which is what the draft banner on the store screen is for. And
// a session that drops and comes straight back sent the router to `/login` and
// then to `/`, discarding a screen that had been opened with `Navigator.push`
// and was therefore invisible to it.
//
// This covers the second. It reproduces the app's router shape — async
// redirect, `refreshListenable` on the auth stream, `/visit/:key/order` under
// `/` — and drives the real [InterruptedLocation], so the logic under test is
// the shipped logic and not a copy of it.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:gf_merch_rep/core/interrupted_location.dart';

/// The app's bridge from the auth stream to a Listenable, copied in shape.
class _RefreshStream extends ChangeNotifier {
  _RefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _sub = stream.asBroadcastStream().listen((_) => notifyListeners());
  }

  late final StreamSubscription<dynamic> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

class _Harness {
  _Harness() {
    router = GoRouter(
      initialLocation: '/',
      refreshListenable: _RefreshStream(auth.stream),
      routes: [
        GoRoute(path: '/login', builder: (_, _) => const Text('LOGIN')),
        GoRoute(
          path: '/',
          builder: (_, _) => const Text('STORES'),
          routes: [
            GoRoute(
              path: 'visit/:key',
              builder: (_, _) => const _StoreScreen(),
              routes: [
                GoRoute(path: 'order', builder: (_, _) => const _OrderScreen()),
              ],
            ),
          ],
        ),
      ],
      redirect: (context, state) async {
        // The app awaits a cached role lookup here on every navigation.
        await Future<void>.delayed(Duration.zero);
        final loggingIn = state.matchedLocation == '/login';
        if (!hasSession) {
          if (loggingIn) return null;
          InterruptedLocation.remember(state.uri.toString());
          return '/login';
        }
        if (loggingIn) return InterruptedLocation.take() ?? '/';
        return null;
      },
    );
  }

  final auth = StreamController<int>.broadcast();
  bool hasSession = true;
  late final GoRouter router;

  void dispose() {
    auth.close();
    router.dispose();
  }
}

class _StoreScreen extends StatelessWidget {
  const _StoreScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('STORE'),
            ElevatedButton(
              onPressed: () => context.go('/visit/abc/order'),
              child: const Text('Take an order'),
            ),
          ],
        ),
      ),
    );
  }
}

class _OrderScreen extends StatelessWidget {
  const _OrderScreen();

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: Text('ORDER')));
}

Future<void> _openOrderScreen(WidgetTester tester, _Harness h) async {
  await tester.pumpWidget(MaterialApp.router(routerConfig: h.router));
  await tester.pumpAndSettle();

  h.router.go('/visit/abc');
  await tester.pumpAndSettle();
  expect(find.text('STORE'), findsOneWidget);

  await tester.tap(find.text('Take an order'));
  await tester.pumpAndSettle();
  expect(find.text('ORDER'), findsOneWidget);
}

void main() {
  setUp(InterruptedLocation.clear);

  testWidgets('a token refresh does not close a half-typed order',
      (tester) async {
    final h = _Harness();
    addTearDown(h.dispose);
    await _openOrderScreen(tester, h);

    // supabase emits on every token refresh, not only sign-in and sign-out.
    // The rep is standing in the shop; nothing about their session changed.
    h.auth.add(1);
    await tester.pumpAndSettle();

    expect(find.text('ORDER'), findsOneWidget,
        reason: 'a routine token refresh threw the rep out of the order');
  });

  testWidgets('a session that drops and comes back returns the rep to the order',
      (tester) async {
    final h = _Harness();
    addTearDown(h.dispose);
    await _openOrderScreen(tester, h);

    // A refresh that fails non-retryably clears the session, and gotrue emits.
    h.hasSession = false;
    h.auth.add(1);
    await tester.pumpAndSettle();

    // Restored from local storage, or the next attempt succeeded. The rep never
    // typed anything: as far as they are concerned nothing happened at all.
    h.hasSession = true;
    h.auth.add(2);
    await tester.pumpAndSettle();

    expect(find.text('ORDER'), findsOneWidget,
        reason: 'the order screen did not survive a session blip');
    expect(find.text('STORES'), findsNothing);
  });

  testWidgets('signing out deliberately does not drop the next rep into the '
      'last one\'s shop', (tester) async {
    final h = _Harness();
    addTearDown(h.dispose);
    await _openOrderScreen(tester, h);

    // What AuthController.signOut does before it calls supabase.
    InterruptedLocation.expectSignOut();
    h.hasSession = false;
    h.auth.add(1);
    await tester.pumpAndSettle();
    expect(find.text('LOGIN'), findsOneWidget);

    h.hasSession = true;
    h.auth.add(2);
    await tester.pumpAndSettle();

    expect(find.text('STORES'), findsOneWidget);
    expect(find.text('ORDER'), findsNothing);
  });
}
