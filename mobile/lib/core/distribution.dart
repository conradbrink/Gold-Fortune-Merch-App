import 'package:flutter/foundation.dart';

import 'env.dart';

/// How this build reaches phones, and so where an update comes from.
///
/// The same code ships three ways:
///
///   * direct      — the signed APK on the download page. The app checks the
///                   server for a newer one and sends the rep to that page.
///   * googlePlay  — the Play build ([Env.playBuild]).
///   * appStore    — every iPhone build. iOS has no other way in.
///
/// **A store build must never point at the download page.** Both stores refuse
/// an app that updates itself from anywhere but the store, and Google Play
/// removes one that installs an APK it did not deliver. So a store build sends
/// the rep to its own store listing, and asks the server only about releases
/// made for that store.
enum DistributionChannel { direct, googlePlay, appStore }

/// The application id on Android and the bundle id on iOS. Permanent: see
/// docs/RELEASE-ANDROID.md.
const kAppId = 'za.co.tickd.app';

/// The channel for a build, as a pure function so it can be tested without a
/// platform. iOS wins over the define: an iPhone build is an App Store build
/// whatever it was compiled with.
DistributionChannel channelFor({
  required TargetPlatform platform,
  required bool playBuild,
}) {
  if (platform == TargetPlatform.iOS) return DistributionChannel.appStore;
  if (playBuild) return DistributionChannel.googlePlay;
  return DistributionChannel.direct;
}

/// This build's channel.
DistributionChannel get distributionChannel =>
    channelFor(platform: defaultTargetPlatform, playBuild: Env.playBuild);

/// The `app_releases.platform` the update check reads for a channel.
///
/// Each channel has its own row, because a store takes hours or days to
/// review a release that the download page has the moment it is uploaded. A
/// floor raised for the APK must not lock out a store install that has nothing
/// newer to update to yet. Today only `android` rows exist, so store builds
/// find nothing and never prompt; the stores update them on their own.
String releasePlatformFor(DistributionChannel channel) => switch (channel) {
      DistributionChannel.direct => 'android',
      DistributionChannel.googlePlay => 'google_play',
      DistributionChannel.appStore => 'app_store',
    };

/// Where "Update" goes, in the order to try them.
///
/// The store app's own link comes first because it opens the listing in the
/// store rather than in a browser; the web link is the fallback for a phone
/// without the store app. Every address is a compile-time constant, never
/// one the server sent — a link taken from a response is an obvious way to
/// point the whole field team at someone else's app.
List<Uri> updateLinksFor(
  DistributionChannel channel, {
  String downloadPageUrl = Env.downloadPageUrl,
  String appStoreId = Env.appStoreId,
}) {
  switch (channel) {
    case DistributionChannel.direct:
      return [Uri.parse(downloadPageUrl)];
    case DistributionChannel.googlePlay:
      return [
        Uri.parse('market://details?id=$kAppId'),
        Uri.parse('https://play.google.com/store/apps/details?id=$kAppId'),
      ];
    case DistributionChannel.appStore:
      // Without the number there is no listing to link to, so the App Store
      // itself is the next best thing. (apps.apple.com has no search page to
      // send a name to: /za/search answered 404 on 31 October 2026.)
      if (appStoreId.isEmpty) {
        return [
          Uri.parse('itms-apps://apps.apple.com/'),
          Uri.parse('https://apps.apple.com/za/'),
        ];
      }
      return [
        Uri.parse('itms-apps://apps.apple.com/app/id$appStoreId'),
        Uri.parse('https://apps.apple.com/app/id$appStoreId'),
      ];
  }
}

/// What the update button says for a channel.
String updateButtonLabelFor(DistributionChannel channel) => switch (channel) {
      DistributionChannel.direct => 'Open the download page',
      DistributionChannel.googlePlay => 'Open Google Play',
      DistributionChannel.appStore => 'Open the App Store',
    };
