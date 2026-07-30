import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/app_update.dart';

/// The update decision, exercised branch by branch.
///
/// Each case names the failure it is protecting against rather than the code
/// path it walks — these branches are only interesting because getting one
/// wrong either nags a rep on every launch or leaves a handset running a build
/// management has withdrawn.
void main() {
  AppUpdateInfo? decide({
    required int installed,
    int release = 5,
    int minSupported = 1,
    int? postponed,
  }) =>
      decideUpdate(
        installedVersionCode: installed,
        releaseVersionCode: release,
        releaseVersionName: '1.2.0',
        minSupportedVersionCode: minSupported,
        postponedVersionCode: postponed,
      );

  test('says nothing when the installed build is the current release', () {
    expect(decide(installed: 5), isNull);
  });

  test('offers an optional update when a newer release exists', () {
    final result = decide(installed: 4);
    expect(result?.requirement, UpdateRequirement.optional);
    expect(result?.versionName, '1.2.0');
  });

  test('stays quiet about a version the rep has already postponed', () {
    expect(decide(installed: 4, postponed: 5), isNull);
  });

  test('a postponement silences only the version it was made against', () {
    // The rep said "Later" to build 5; build 6 then ships. If this returned
    // null, one dismissal would mute the app permanently.
    final result = decide(installed: 4, release: 6, postponed: 5);
    expect(result?.requirement, UpdateRequirement.optional);
  });

  test('forces an update when the installed build is below the floor', () {
    final result = decide(installed: 2, release: 5, minSupported: 3);
    expect(result?.requirement, UpdateRequirement.required);
  });

  test('a postponement cannot defer a forced update', () {
    // The dangerous case: the rep postponed this release while it was
    // optional, and management then raised the floor to include it.
    final result =
        decide(installed: 2, release: 5, minSupported: 3, postponed: 5);
    expect(result?.requirement, UpdateRequirement.required);
  });

  test('a build newer than the published release is left alone', () {
    // A locally built debug APK carries a higher build number. Offering it a
    // "newer" version would be proposing a downgrade.
    expect(decide(installed: 99, release: 5), isNull);
  });

  test('the floor is judged on the installed build, not the newest release', () {
    // Installed 3 with a floor of 3: at the floor exactly, so not forced —
    // an off-by-one here locks out a handset that is entitled to keep working.
    final result = decide(installed: 3, release: 5, minSupported: 3);
    expect(result?.requirement, UpdateRequirement.optional);
  });
}
