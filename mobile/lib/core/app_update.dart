import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'providers.dart';
import 'supabase_client.dart';

/// How badly the installed app needs replacing.
enum UpdateRequirement {
  /// Installed version is the current one, or newer (a local debug build).
  upToDate,

  /// A newer release exists. The rep is told, and may carry on working.
  optional,

  /// The installed version is below the floor management set. The app stops
  /// until it is replaced — this exists for a security or compatibility fix
  /// that cannot be left running in the field.
  required,
}

class AppUpdateInfo {
  const AppUpdateInfo({
    required this.requirement,
    required this.versionName,
    required this.versionCode,
    required this.installedVersionCode,
    required this.notes,
  });

  final UpdateRequirement requirement;
  final String versionName;
  final int versionCode;
  final int installedVersionCode;
  final List<String> notes;
}

/// Key for the version the rep has said "Later" to. Not scoped per user: it is
/// a property of this handset's install, and a second rep signing in on the
/// same phone is looking at the same out-of-date APK.
const _postponedKey = 'update.postponed_version_code';

/// Checks whether a newer Android release has been published.
///
/// Returns null — meaning "carry on" — whenever the answer cannot be
/// established: offline, the request failed, nothing published yet, or the
/// build number is unreadable. **A failed update check must never block the
/// app.** Reps work in places with no signal, and an update check that turns
/// into a lockout when the network is down is worse than no update check.
final appUpdateProvider = FutureProvider<AppUpdateInfo?>((ref) async {
  final db = ref.watch(appDatabaseProvider);

  final info = await PackageInfo.fromPlatform();
  final installed = int.tryParse(info.buildNumber);
  if (installed == null) return null;

  final Map<String, dynamic>? row;
  try {
    row = await supabase
        .from('app_releases')
        .select('version_name, version_code, notes, min_supported_version_code')
        .eq('platform', 'android')
        .eq('is_current', true)
        .maybeSingle();
  } catch (_) {
    return null;
  }
  if (row == null) return null;

  final versionCode = row['version_code'] as int?;
  final versionName = row['version_name'] as String?;
  if (versionCode == null || versionName == null) return null;

  final minSupported = row['min_supported_version_code'] as int? ?? 1;
  final notes = (row['notes'] as List?)?.cast<String>() ?? const <String>[];

  final postponed = int.tryParse(await db.getValue(_postponedKey) ?? '');

  return decideUpdate(
    installedVersionCode: installed,
    releaseVersionCode: versionCode,
    releaseVersionName: versionName,
    minSupportedVersionCode: minSupported,
    postponedVersionCode: postponed,
    notes: notes,
  );
});

/// The whole update decision, as a pure function.
///
/// Separated from the provider so it can be tested without a package info
/// channel, a database or a network — the branches here are where a mistake
/// either nags a rep forever or fails to block a handset that must be blocked.
AppUpdateInfo? decideUpdate({
  required int installedVersionCode,
  required int releaseVersionCode,
  required String releaseVersionName,
  required int minSupportedVersionCode,
  required int? postponedVersionCode,
  List<String> notes = const [],
}) {
  AppUpdateInfo info(UpdateRequirement requirement) => AppUpdateInfo(
        requirement: requirement,
        versionName: releaseVersionName,
        versionCode: releaseVersionCode,
        installedVersionCode: installedVersionCode,
        notes: notes,
      );

  // The forced floor is checked against the installed build, not against the
  // newest release, so an old handset is blocked even if the rep happens to
  // have some intermediate version. Checked first: a postponement must never
  // be able to defer a mandatory update.
  if (installedVersionCode < minSupportedVersionCode) {
    return info(UpdateRequirement.required);
  }

  // `>=` rather than `==`: a locally built debug APK can carry a higher build
  // number than anything published, and telling that phone to "update" to an
  // older release would be a downgrade Android refuses anyway.
  if (installedVersionCode >= releaseVersionCode) return null;

  // Postponement applies to one specific version. Saying "Later" to 1.1.0 must
  // not also silence 1.2.0, or one dismissal mutes the app for good.
  if (postponedVersionCode == releaseVersionCode) return null;

  return info(UpdateRequirement.optional);
}

/// Records that the rep chose "Later" for this version, then re-runs the check
/// so the banner disappears without a restart.
Future<void> postponeUpdate(WidgetRef ref, int versionCode) async {
  await ref.read(appDatabaseProvider).setValue(_postponedKey, '$versionCode');
  ref.invalidate(appUpdateProvider);
}
