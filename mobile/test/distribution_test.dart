import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gf_merch_rep/core/distribution.dart';
import 'package:gf_merch_rep/core/env.dart';

/// Where an update comes from, per build.
///
/// The failure these protect against is a store build that sends a rep to the
/// download page: both stores reject an app that updates itself from anywhere
/// else, and Google Play removes one that installs an APK it did not deliver.
void main() {
  group('channelFor', () {
    test('an ordinary Android build is the download-page APK', () {
      expect(
        channelFor(platform: TargetPlatform.android, playBuild: false),
        DistributionChannel.direct,
      );
    });

    test('the Play define makes it the Google Play build', () {
      expect(
        channelFor(platform: TargetPlatform.android, playBuild: true),
        DistributionChannel.googlePlay,
      );
    });

    test('an iPhone build is always the App Store build', () {
      // Whatever it was compiled with: an iPhone has no other way in.
      for (final playBuild in [false, true]) {
        expect(
          channelFor(platform: TargetPlatform.iOS, playBuild: playBuild),
          DistributionChannel.appStore,
        );
      }
    });

    test('these tests run as the download-page build', () {
      // `flutter test` passes no define. If this fails, a define leaked into
      // the test run and the cases below no longer say what they claim.
      expect(Env.playBuild, isFalse);
      expect(Env.downloadPageUrl, endsWith('/download'));
    });
  });

  group('checksForUpdates', () {
    test('the APK asks the server for a newer release', () {
      expect(checksForUpdates(DistributionChannel.direct), isTrue);
    });

    test('store builds do not ask for rows that cannot exist yet', () {
      expect(kStoreReleaseRows, isFalse);
      expect(checksForUpdates(DistributionChannel.googlePlay), isFalse);
      expect(checksForUpdates(DistributionChannel.appStore), isFalse);
    });
  });

  group('releasePlatformFor', () {
    test('the APK keeps reading the rows the download page publishes', () {
      expect(releasePlatformFor(DistributionChannel.direct), 'android');
    });

    test('each store reads only its own releases', () {
      // A floor raised for the APK must not lock out a store install that has
      // nothing newer to update to while the store reviews the release.
      expect(releasePlatformFor(DistributionChannel.googlePlay), 'google_play');
      expect(releasePlatformFor(DistributionChannel.appStore), 'app_store');
    });
  });

  group('updateLinksFor', () {
    test('the APK goes to the download page', () {
      expect(
        updateLinksFor(
          DistributionChannel.direct,
          downloadPageUrl: 'https://app.tickd.co.za/download',
        ),
        [Uri.parse('https://app.tickd.co.za/download')],
      );
    });

    test('the Play build opens the Play Store, never the download page', () {
      final links = updateLinksFor(
        DistributionChannel.googlePlay,
        downloadPageUrl: 'https://app.tickd.co.za/download',
      );
      expect(links.first, Uri.parse('market://details?id=za.co.tickd.app'));
      expect(
        links.last,
        Uri.parse('https://play.google.com/store/apps/details?id=za.co.tickd.app'),
      );
      expect(links.where((l) => l.path.contains('download')), isEmpty);
    });

    test('the iPhone build opens its App Store listing', () {
      final links = updateLinksFor(
        DistributionChannel.appStore,
        downloadPageUrl: 'https://app.tickd.co.za/download',
        appStoreId: '1234567890',
      );
      expect(links, [
        Uri.parse('itms-apps://apps.apple.com/app/id1234567890'),
        Uri.parse('https://apps.apple.com/app/id1234567890'),
      ]);
    });

    test('an iPhone build without the store number still stays in the store',
        () {
      final links = updateLinksFor(
        DistributionChannel.appStore,
        downloadPageUrl: 'https://app.tickd.co.za/download',
        appStoreId: '',
      );
      expect(links.map((l) => l.host), everyElement('apps.apple.com'));
      expect(links.last.scheme, 'https');
    });
  });

  test('every channel has a button label', () {
    expect(
      DistributionChannel.values.map(updateButtonLabelFor),
      ['Open the download page', 'Open Google Play', 'Open the App Store'],
    );
  });
}
