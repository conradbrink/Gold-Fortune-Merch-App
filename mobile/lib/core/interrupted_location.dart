/// Where the rep was standing when the session vanished under them.
///
/// A rep on a 1 GB handset in a shop loses their session for reasons that have
/// nothing to do with them: a token refresh dies mid-flight as the signal drops
/// (Sentry FLUTTER-1, ten times in two days on one phone), or Android reclaims
/// the app while it is in the background. The session comes straight back from
/// local storage — but the router had already sent them to `/login`, and coming
/// back it sent them to `/`. The rep, who never saw a login screen, watched a
/// half-typed order turn into the list of shops.
///
/// So the router remembers the location it interrupted and returns them to it.
///
/// [expectSignOut] is what separates an accident from an intention. A
/// deliberate sign out must not be followed by the next person being dropped
/// into the last rep's shop, so `AuthController.signOut` says so on the way
/// past. Nothing else does, because nothing else is deliberate.
///
/// It has to be a flag set *before* the sign-out rather than a wipe after it:
/// clearing on the way past achieves nothing, because losing the session runs
/// the redirect again and it remembers the location a second time. Tested —
/// that was the first attempt at this, and the test caught it.
class InterruptedLocation {
  InterruptedLocation._();

  static String? _location;
  static bool _deliberate = false;

  static String? get location => _location;

  /// The sign-out about to happen was asked for. Nothing is worth returning to.
  static void expectSignOut() {
    _deliberate = true;
    _location = null;
  }

  /// Records where the rep was, unless something is already recorded — the
  /// first interruption is the one worth returning to. A second redirect while
  /// still signed out would otherwise overwrite `/visit/abc/order` with
  /// `/login`.
  static void remember(String location) {
    if (_deliberate) return;
    _location ??= location;
  }

  /// A session is alive and the rep is somewhere in the app.
  ///
  /// This is what stops [expectSignOut] latching for the rest of the process.
  /// `AuthController.signOut` catches both of its attempts, so a sign-out can
  /// fail with the session still in place: the router never reaches `/login`,
  /// [take] never runs, and every later *accidental* session loss would go
  /// unrecorded — route recovery silently off for the rest of the day, on the
  /// handsets that need it most. Called on the ordinary navigation path, where
  /// a live session is proof the sign-out did not happen.
  static void noteSessionAlive() {
    _deliberate = false;
  }

  /// Takes the remembered location, leaving nothing behind.
  ///
  /// Called when a session exists again, which is also the moment a deliberate
  /// sign-out has finished happening — so the flag comes down here rather than
  /// staying up for the rest of the process.
  static String? take() {
    final location = _location;
    _location = null;
    _deliberate = false;
    return location;
  }

  static void clear() {
    _location = null;
    _deliberate = false;
  }
}
