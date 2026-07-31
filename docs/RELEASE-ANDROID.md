# Building and releasing the Android app

The rep app is Flutter, in `mobile/`. It is distributed as a signed APK from
the website — not through the Play Store — so there is no review queue and no
staged rollout. What you upload is what the field gets.

**Package id: `com.goldfortune.gf_merch_rep`.** This is permanent. Changing it
produces a *different app* that installs alongside the old one instead of
updating it, and every rep would have to be migrated by hand.

---

## Part 1 — The signing key (once, ever)

Android identifies an app by its package id **and its signing key**. An update
signed with a different key is rejected as a different app. There is no reset,
no recovery and no support route: **lose this key and this app can never be
updated again.** The only fix is a new package id and a manual reinstall by
every rep.

### Create it

`keytool` ships with the JDK bundled in Android Studio and is usually not on
the PATH:

```bash
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -genkeypair -v -keystore ~/gf-merch-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias gf-merch
```

It asks for a keystore password, then name and organisation details, then a key
password (pressing Return reuses the keystore password, which is fine).

Use a strong password **from your password manager**, not one you invent at the
prompt. `-validity 10000` is about 27 years; a key that expires mid-life is a
migration nobody wants.

### Point Gradle at it

Create `mobile/android/key.properties` — already gitignored, and CI fails the
build if it is ever committed:

```properties
storePassword=<the keystore password>
keyPassword=<the key password>
keyAlias=gf-merch
storeFile=/Users/conradbrink/gf-merch-release.jks
```

`storeFile` must be an absolute path. Keep the `.jks` **outside** the
repository — the home directory is fine, the project folder is not.

### Back it up

Two things must survive this laptop dying: **the `.jks` file** and **its
password**. They must be stored so that losing one does not lose both.

Recommended:

- **Password** → your password manager, in an entry named "GF Merch Android
  signing key", together with the alias.
- **`.jks` file** → an encrypted backup you control: an encrypted disk image, a
  private password-manager attachment, or a company drive that is not the
  laptop. Not email, not the repo, not a public share.

Verify the backup by restoring it somewhere else and running
`keytool -list -keystore <restored.jks>`. An untested backup is a hope.

---

## Part 2 — Cutting a release

### 1. Decide the version

`mobile/pubspec.yaml`, the `version:` line — `versionName+versionCode`:

```yaml
version: 1.1.0+2
```

- **`versionName`** (`1.1.0`) is what people see. Must be `x.y.z`; the database
  rejects anything else.
- **`versionCode`** (`2`) is what Android compares. **It must increase on every
  single release.** Android refuses to install an APK whose code is not higher
  than the installed one, and the manifest enforces uniqueness too.

### 2. Build it

```bash
cd mobile
flutter build apk --release \
  --target-platform android-arm,android-arm64 \
  --dart-define=GF_WEB_BASE_URL=https://<your-production-domain>
```

⚠️ **`--target-platform android-arm,android-arm64` is required on the Supabase
Free plan.** A universal APK bundles a third architecture, `x86_64`, and comes
out at ~63 MB — over the **50 MB project-wide upload ceiling on Free**, which
the bucket's own 200 MB limit cannot override. The upload fails with
`413 EntityTooLarge`. Dropping `x86_64` gives ~41 MB and costs nothing real:
`x86_64` is only used by Intel Android emulators, never by a phone. (Apple
Silicon emulators are `arm64` and still work.) On Supabase Pro the ceiling
rises and a universal APK is fine.

⚠️ **The `--dart-define` is not optional.** Without it the app falls back to
the placeholder URL in `mobile/lib/core/env.dart`, and the in-app "Update"
button sends reps to a domain that may not be yours.

The build prints which key it used. It must say:

```
▸ Signing release with the keystore in android/key.properties
```

If it says **WARNING: no android/key.properties — signing release with DEBUG
keys**, stop. A debug-signed APK cannot be updated by a properly signed one
later.

Output: `mobile/build/app/outputs/flutter-apk/app-release.apk`.

### 3. Check what you built

```bash
cd mobile
unzip -p build/app/outputs/flutter-apk/app-release.apk assets/flutter_assets/NOTICES >/dev/null && echo "APK readable"

# The production Supabase URL must be in there, and localhost must not.
strings build/app/outputs/flutter-apk/app-release.apk | grep -c "rxtlnetlzmbqirqaalkw.supabase.co"
strings build/app/outputs/flutter-apk/app-release.apk | grep -ciE "localhost|10\.0\.2\.2" || echo "0 (good)"

# Confirm the signature is the release key, not the debug key.
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
~/Library/Android/sdk/build-tools/36.0.0/apksigner verify --print-certs \
  build/app/outputs/flutter-apk/app-release.apk
```

The certificate owner must be the one you created, **not** `CN=Android Debug`.
For this project it is `CN=Conrad Brink, O=Gold Fortune Distribution, C=BW`,
SHA-256 `0b68016543e7fed5ed0433bf8e1c2ed50fdac2be66a96e3b40b4a45305b1f394`.
**Every future release must show that same digest** — a different one means a
different key, and Android will refuse the update.

⚠️ **Do not use `keytool -printcert -jarfile` for this.** It answers
"Not a signed jar file" on a correctly signed APK and it is easy to read that
as "the signing failed". Modern AGP signs with **APK Signature Scheme v2 only**
and omits the v1 JAR signature that `keytool` looks for, so there are no
`META-INF/*.RSA` files to find. `apksigner` is the tool that understands v2.
It also needs `JAVA_HOME` set, or it reports "Unable to locate a Java Runtime".

### 4. Upload and publish

Publishing is two steps: the file, then the manifest row that points at it.
Both use the service-role key, because `app_releases` has no write policy —
no signed-in user, manager included, can change what the fleet is told to
install.

```bash
cd "$(git rev-parse --show-toplevel)"
set -a && . web/.env.local && set +a

VERSION=1.1.0
CODE=2
APK=mobile/build/app/outputs/flutter-apk/app-release.apk
SIZE=$(stat -f%z "$APK")

curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/app-releases/$VERSION/app-release.apk" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary "@$APK"

echo "uploaded $SIZE bytes"
```

Then, in the **Supabase SQL editor**, publish it. Doing both statements in one
transaction is what stops there being a moment with no current release, or two:

```sql
begin;

update public.app_releases set is_current = false where platform = 'android';

insert into public.app_releases
  (version_name, version_code, release_date, notes,
   storage_path, file_size_bytes, min_supported_version_code, is_current)
values
  ('1.1.0', 2, current_date,
   array[
     'Photos now upload in the background',
     'Fixed a crash when checking in with no GPS signal'
   ],
   '1.1.0/app-release.apk',
   <SIZE from above>,
   1,          -- forced-update floor; see below
   true);

commit;
```

Then check <https://your-domain/download> shows the new version, date, size
and notes, and that the Download button serves the new APK.

### The forced-update floor

`min_supported_version_code` is how you make an update mandatory. Any app whose
`versionCode` is **below** it is blocked with an "Update required" screen and
cannot be used until replaced.

- Normal release: leave it at `1`. Reps see a dismissible banner and can
  postpone. A postponement applies only to that one version.
- Security or compatibility release: set it to the `version_code` of the
  release that fixes the problem.

**Use it sparingly.** A rep in the field who cannot work until they find signal
and download 40 MB has lost their morning. Anything already saved on their
phone is kept and syncs after updating — the screen says so — but the visit
they are standing in front of still stops.

### Rolling an Android release back

There is no "unpublish". Reps who already installed the bad APK have it.

1. Make the previous release current again:
   ```sql
   begin;
   update public.app_releases set is_current = false where platform = 'android';
   update public.app_releases set is_current = true
    where platform = 'android' and version_code = <previous code>;
   commit;
   ```
   New downloads now get the old version. **Reps who already updated will not
   downgrade** — Android refuses a lower `versionCode`.
2. For anyone already on the bad build, the only real fix is forward: build a
   new release with a *higher* `versionCode` containing the fix.

This is why `versionCode` only ever goes up, and why the download page should
be checked immediately after publishing.

---

## Release checklist

- [ ] `versionCode` increased in `pubspec.yaml`
- [ ] `flutter analyze` and `flutter test` clean
- [ ] Built with `--release` **and** `--dart-define=GF_WEB_BASE_URL=...`
- [ ] Build printed "Signing release with the keystore"
- [ ] `keytool -printcert -jarfile` shows the production certificate
- [ ] No `localhost` in the APK
- [ ] APK uploaded to the `app-releases` bucket
- [ ] `app_releases` row inserted, old row's `is_current` cleared, in one transaction
- [ ] Download page shows the right version, date and size
- [ ] Installed over the previous version on a real handset — signed-in session
      and any unsynced visits survived

⚠️ **A debug build cannot be upgraded to a release build.** They are signed with
different keys, so Android refuses with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match`. Anyone who has
been running a development build must **uninstall it first**, which wipes their
local data. This only affects development handsets — reps who only ever install
from the download page upgrade normally and keep everything.
