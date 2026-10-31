# Releasing to Google Play and the App Store

The phone app has only ever reached phones as the signed APK on the download
page (`docs/RELEASE-ANDROID.md`). This is what is different for the stores.

**Status on 31 October 2026:** nothing has been published to either store.
The developer accounts are still being opened, and the iPhone build has never
been compiled (see "iPhone" below).

---

## What a store build does differently

The same code ships three ways (`mobile/lib/core/distribution.dart`):

| Build | How it is made | "Update" opens | Update check reads |
|---|---|---|---|
| Download page APK | `--flavor tickd` | the download page | `app_releases` rows with `platform = 'android'` |
| Google Play | `--flavor tickd --dart-define=TICKD_STORE=play` | the Play Store listing | `platform = 'google_play'` |
| iPhone | every iOS build | the App Store listing | `platform = 'app_store'` |

**A store build never points at the download page.** Both stores refuse an app
that updates itself from anywhere but the store, and Google Play removes one
that installs an APK it did not deliver. The Play build is compiled with an
empty download address (`Env.downloadPageUrl`), so the link is not in it at
all.

**Store builds never prompt for an update yet.** `app_releases` only accepts
`platform = 'android'`, and every row needs an uploaded file
(`storage_path`, `file_size_bytes`). So store builds do not ask at all
(`kStoreReleaseRows` is false), and the stores update those phones
themselves. Set it true in the same change as the migration below. To force a store
install off an old version later, a migration has to let store rows in
(platform check widened, file columns optional for store rows). Add a store
row only once that version is live in that store: a floor raised before the
store has approved the release locks phones out with nothing to update to.

## Location: "while using the app" is enough

The workday trail no longer asks for "Allow all the time", and the Android
build no longer declares `ACCESS_BACKGROUND_LOCATION`. The trail only starts
with the app open. A location stream started then keeps running behind other
apps: on Android through the foreground service and its notification, on an
iPhone through background location updates and the blue location pill.

Tested on 31 October 2026 on an Android 14 emulator with only "while using the
app" granted: with the app in the background for six minutes, a ping reached
the server every minute (the company's interval was set to 1 minute), and
Android logged the location access as coming from a foreground service. The
emulator kept reporting the same spot, because the trail's medium accuracy does
not switch the GPS on and an emulator has no Wi-Fi or cell signal to locate
from; a phone does.

Phones that had "Allow all the time" lose it with this update, and keep
"while using the app". Nothing for the rep to do.

---

## Google Play

### Build

```bash
cd mobile
flutter build appbundle --release --flavor tickd \
  --build-name 1.2.9 --build-number 109 \
  --dart-define=TICKD_STORE=play \
  --dart-define=GF_WEB_BASE_URL=https://app.tickd.co.za \
  --dart-define=SENTRY_DSN=<from Sentry, as in RELEASE-ANDROID.md>
```

Output: `mobile/build/app/outputs/bundle/tickdRelease/app-tickd-release.aab`.

**Version codes are shared with the download page.** If Play App Signing
uses the existing release key (recommended, below), a phone that installed the
APK from the download page can be updated by Play. That only works while
Play's version code is above the installed one, so both channels count up one
sequence, and a code is never used twice for two different builds.

### Check it

```bash
AAB=build/app/outputs/bundle/tickdRelease/app-tickd-release.aab

# Signed with the release key: SHA-256 0B:68:01:65:…:F3:94
# (keytool is in Android Studio's JDK, as in RELEASE-ANDROID.md)
keytool -printcert -jarfile "$AAB" | grep SHA256

# No link to the download page in the app's own code
unzip -p "$AAB" base/lib/arm64-v8a/libapp.so | strings | grep -c 'tickd.co.za/download'   # 0

# No background location, no photo or video access
unzip -p "$AAB" base/manifest/AndroidManifest.xml | strings \
  | grep -E 'ACCESS_BACKGROUND_LOCATION|READ_MEDIA|READ_EXTERNAL'                          # nothing
```

All three held for a test build of this branch (1.2.9, build 109) on
31 October 2026, which was not kept: build again from `main` when the account
is open.

### In the Play Console

- **App signing:** choose to use the existing key, and upload it with the
  Play Console's encryption tool. This is what lets download-page installs
  update from Play, and it cannot be changed afterwards. The owner decides.
- **Foreground service permissions:** declare `FOREGROUND_SERVICE_LOCATION`
  for the workday trail, with a short screen recording: Start workday, the
  notification appears, the app goes to the background, the trail keeps
  recording. On Android 13 and later the app asks to show notifications as
  the rep starts the day; allow it, or the "Workday in progress"
  notification stays hidden (the trail records either way).
- **Background location:** none to declare.
- **Privacy policy:** https://tickd.co.za/privacy. The app's menu (⋮ on the
  home screen) links to it too, as both stores ask.
- **Delete account:** https://tickd.co.za/delete-account. The app's menu (⋮
  on the home screen) also links to it.
- **App access:** reviewers sign in to a demo company with made-up shops and
  products, set up on production for review. The login is kept outside this
  repository, which is public.
- **Data safety:** what the app collects is listed under "What the app
  collects" in the Privacy policy.

---

## iPhone

**Never built.** Building needs Xcode 26 (App Store Connect has required it
since 28 April 2026), which needs macOS 15.6 or later and about 40 GB free.

Ready in the project, unbuilt:

- the location, camera and photo permission texts in `ios/Runner/Info.plist`,
  the `location` background mode, and `ITSAppUsesNonExemptEncryption = false`
  (only standard HTTPS, so no export questions);
- iPhone only (`TARGETED_DEVICE_FAMILY = 1`), so no iPad screenshots or iPad
  review;
- the Tickd icon (`assets/product_mark_ios.png`, drawn by
  `mobile/tool/make_product_mark.py`, no transparency).

The iOS project has no `tickd` or `legacy` schemes, so build without
`--flavor`. `appFlavor` is then empty, which the app reads as Tickd.

```bash
cd mobile
flutter build ipa --release \
  --build-name 1.2.9 --build-number 109 \
  --dart-define=GF_WEB_BASE_URL=https://app.tickd.co.za \
  --dart-define=SENTRY_DSN=<from Sentry> \
  --dart-define=TICKD_APP_STORE_ID=<the number in the App Store link>
```

The App Store number exists once the app is created in App Store Connect,
before the first upload. Without it the update button can only open the App
Store's front page (apps.apple.com has no search link to send a name to).

Still to check on the first build and on a real iPhone:

- that every plugin compiles with Xcode 26, and whether App Store Connect asks
  for a privacy manifest;
- the trail behind other apps, the blue pill, and battery use over a day.
  iOS has no time interval, so it reports by distance: every 100 m
  (`kIosTrackingDistanceFilterM`). Check that a rep standing in a shop still
  shows on the live map often enough;
- check-in, camera, photo picker and file opening.
