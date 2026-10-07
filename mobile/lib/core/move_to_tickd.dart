import 'package:flutter/services.dart' show appFlavor;

/// The move from the old app (com.goldfortune.gf_merch_rep) to Tickd
/// (za.co.tickd.app).
///
/// Android treats a different app id as a different app: Tickd installs
/// *beside* the old one rather than updating it, and nothing the old app has
/// not yet sent to the server comes with it. So the old id gets one last
/// release (1.1.13, the `legacy` flavour) whose only new job is to walk each
/// rep across in a safe order — end the day, sync everything, install Tickd,
/// sign in, and only then remove the old app.
///
/// How it knows Tickd is out: Tickd's builds are numbered from
/// [kTickdFirstVersionCode]. When the current Android release on the server is
/// at or above it, a legacy build stops offering "updates" (that would install
/// a second app with no explanation) and shows the move instead. Nothing on
/// the server changes to make this happen; publishing Tickd's first build does.

/// The first version code Tickd's builds use; the old id never reached it.
const kTickdFirstVersionCode = 100;

/// True in the old-id build (`flutter build apk --flavor legacy`).
bool get isLegacyBuild => appFlavor == 'legacy';

/// Whether the old app may be removed yet: only with no workday open in it and
/// nothing waiting to sync. Unknown (`pending == null`, still counting) is not
/// "nothing" — removing the app on a guess would lose exactly what this release
/// exists to protect.
bool readyToRemoveOldApp({required bool dayOpen, required int? pending}) =>
    !dayOpen && pending == 0;
