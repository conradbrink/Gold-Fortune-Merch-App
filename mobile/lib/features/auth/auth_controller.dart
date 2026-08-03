import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
// `SignOutScope` lives in gotrue and is not re-exported by the barrel that
// `supabase_client.dart` pulls in.
import 'package:supabase_flutter/supabase_flutter.dart' show SignOutScope;

import '../../core/supabase_client.dart';

class AuthController extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {
    // No initial async work — this notifier only reacts to sign-in/out calls.
  }

  Future<void> signIn({required String email, required String password}) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await supabase.auth.signInWithPassword(email: email, password: password);
    });
  }

  /// Signs out, and does not depend on the network to do it.
  ///
  /// `signOut()` calls `/auth/v1/logout` to revoke the refresh token server
  /// side. With no signal that host lookup throws, and the throw escaped —
  /// unlike `signIn` directly above, which has always been wrapped in
  /// `AsyncValue.guard`. Sentry FLUTTER-5 on 1.0.1+2 is that crash: level
  /// fatal, unhandled, from a rep tapping sign out with no bars.
  ///
  /// Local scope first, so the session on this handset is cleared whatever the
  /// server hears. A rep handing their phone over, or signing out to let a
  /// colleague on, needs the session gone from *this* device; telling the
  /// server is the part that can wait.
  ///
  /// The global revoke is attempted afterwards and its failure swallowed. The
  /// cost of not revoking is a refresh token that stays valid until it expires
  /// on its own — worth it against an app that crashes instead of signing out.
  Future<void> signOut() async {
    try {
      await supabase.auth.signOut(scope: SignOutScope.global);
    } catch (_) {
      // Offline, or the endpoint refused. The local session still has to go.
      try {
        await supabase.auth.signOut(scope: SignOutScope.local);
      } catch (_) {
        // Nothing left to try. The router sends the user to /login on the next
        // auth state read either way, and a crash here is what we are fixing.
      }
    }
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, void>(
  AuthController.new,
);
