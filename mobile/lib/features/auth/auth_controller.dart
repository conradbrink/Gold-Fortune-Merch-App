import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
// `SignOutScope` lives in gotrue and is not re-exported by the barrel that
// `supabase_client.dart` pulls in.
import 'package:supabase_flutter/supabase_flutter.dart'
    show AuthException, SignOutScope;

import '../../core/interrupted_location.dart';
import '../../core/supabase_client.dart';
import 'phone_login.dart';

class AuthController extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {
    // No initial async work — this notifier only reacts to sign-in/out calls.
  }

  /// Signs in with an email, or a cell phone number ([loginCandidates]):
  /// each way of reading the number is tried until one is accepted, and only
  /// a wrong password moves on to the next.
  Future<void> signIn({
    required String login,
    required String password,
    String? country,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final logins = loginCandidates(login, country: country);
      if (logins.isEmpty) {
        throw Exception(
          'Type your email address, or your cell phone number.',
        );
      }
      for (var i = 0; i < logins.length; i++) {
        try {
          await supabase.auth.signInWithPassword(
            email: logins[i],
            password: password,
          );
          return;
        } on AuthException catch (e) {
          final wrongPassword = RegExp(
            'invalid login credentials',
            caseSensitive: false,
          ).hasMatch(e.message);
          if (!wrongPassword || i == logins.length - 1) rethrow;
        }
      }
    });
  }

  /// Signs out of this handset, and does not depend on the network to do it.
  ///
  /// `signOut()` calls `/auth/v1/logout` to revoke the session server side.
  /// With no signal that host lookup throws, and the throw escaped — unlike
  /// `signIn` directly above, which has always been wrapped in
  /// `AsyncValue.guard`. Sentry FLUTTER-5 on 1.0.1+2 is that crash: level
  /// fatal, unhandled, from a rep tapping sign out with no bars.
  ///
  /// Local scope: the server ends this handset's session and no other. It was
  /// global until 31 October 2026, which also ended the same person's sign-in
  /// on the web dashboard and on any other phone, and each of those then met
  /// a refresh the server refused — what the web's own global sign-out did to
  /// a shared login's iPhone (Sentry JAVASCRIPT-NEXTJS-5).
  ///
  /// gotrue removes the session from this handset before it calls the
  /// server, so a call that fails offline still signs out here. That is the
  /// part that matters to a rep handing their phone over or signing out to
  /// let a colleague on. The cost is a refresh token that stays valid until
  /// it expires on its own, which is a better outcome than an app that
  /// crashes instead of signing out.
  Future<void> signOut() async {
    // Deliberate, unlike the session losses InterruptedLocation exists for.
    // Whoever signs in next must land on their own day, not in the last rep's
    // shop with a half-typed order on screen.
    InterruptedLocation.expectSignOut();
    try {
      await supabase.auth.signOut(scope: SignOutScope.local);
    } catch (_) {
      // Offline, or the endpoint refused. The session has already left this
      // handset, and the router sends the user to /login on the next auth
      // state read; a crash here is what we are fixing.
    }
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, void>(
  AuthController.new,
);
