# Go-live checklist

Work through this before the app is put in front of real reps. Ordered by what
hurts most if skipped.

## Blocking — do not go live without these

- [ ] **Set the three merchandiser passwords.** Supabase → Authentication →
      Users → Reset password for Atang, Tshepo and Harry. Check first that
      `@goldfortune.dev` mailboxes actually exist; if not, change each auth
      user's email to one the rep can receive at, then reset.
- [ ] **Enable leaked-password protection.** Supabase → Authentication →
      Policies. Checks new passwords against HaveIBeenPwned. Currently off, and
      the invite route only enforces a minimum of eight characters.
- [ ] **Confirm the Supabase spend cap is on.** Settings → Billing. On by
      default for Free and Pro; verify rather than assume.
- [ ] **Create a release signing keystore for Android.** Gradle is wired for it
      already; it needs the keystore and a `key.properties` beside it. Until
      both exist the build falls back to debug keys and prints a warning saying
      so. Play Store rejects a debug-signed build, and — worse — a listing
      published with one can never be updated by a properly signed build.

      `keytool` is not on the PATH on this machine; use the JDK bundled with
      Android Studio:

      ```bash
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" \
        -genkeypair -v -keystore ~/gf-merch-release.jks \
        -keyalg RSA -keysize 2048 -validity 10000 -alias gf-merch
      ```

      Then create `mobile/android/key.properties` (gitignored) with
      `storePassword`, `keyPassword`, `keyAlias=gf-merch` and the absolute
      `storeFile` path. Verify with `flutter build apk --release` — it must
      print "Signing release with the keystore in android/key.properties".

      **Back up the .jks and its password somewhere separate from this laptop.**
      This is the one credential in the project that cannot be reset or
      recovered. Losing it means never shipping another update.
- [ ] **Run the security regression suite** and confirm 18/18:
      `supabase/tests/security_regression.sql`.

## Cost controls

Rate limiting caps what the app itself can spend. These cap what a *leaked key*
can spend, which the app cannot control.

- [ ] **Google Cloud → APIs & Services → Credentials → the browser Maps key.**
      Application restrictions = **Websites**, listing localhost and the
      production domain. API restrictions = **Maps JavaScript + Places** only.
      This matters more than any quota: a quota caps what a stolen key costs,
      a referrer restriction stops it working.
- [ ] **Google Cloud → Quotas.** Per-day request caps on Places, Geocoding and
      Maps JavaScript. Suggested for a 209-store estate: 500 / 500 / 1,000.
      *Quota editing is blocked on the free trial* — revisit at activation.
- [ ] **Google Cloud → Quotas → Configurations: turn the Quota Adjuster off.**
      It automatically raises quotas as usage grows, which defeats the ceiling.
- [ ] **Google Cloud → Billing → Budgets & alerts.** Email at 50/90/100%.
      Alerts only; Google has no hard spend stop, which is why the quotas above
      are the real control.
- [ ] **OpenAI → Settings → Limits.** Monthly budget and notification
      threshold. This one *does* stop serving at the cap. Use a project-scoped
      key so another workload cannot spend the same budget.
- [ ] **Supabase → Settings → Billing → usage alerts** for database size,
      egress and storage.

## Emergency controls

If a bill is climbing and the cause is not yet known, switch off the paid
feature rather than the product. From the Supabase SQL editor:

```sql
-- Stop all AI insight generation
update public.service_flags
   set insights_enabled = false,
       notice = 'Paused while we investigate usage',
       updated_at = now();

-- Stop all address lookups
update public.service_flags set geocoding_enabled = false, updated_at = now();

-- Back on
update public.service_flags
   set insights_enabled = true, geocoding_enabled = true, notice = null;
```

Reps keep checking in, submitting forms, answering promotions and uploading
photos throughout — none of that costs anything per use.

To tighten a rate limit instead of switching a feature off, edit `LIMITS` in
`web/lib/rate-limit.ts` and redeploy. The counters themselves are in
`public.rate_limits` and are not editable by any user.

## Verification before release

- [ ] `npx tsc --noEmit` clean in `web/`
- [ ] `flutter analyze` and `flutter test` clean in `mobile/`
- [ ] `npm run build` succeeds
- [ ] Secrets absent from build artifacts — grep the release APK and
      `.next/static` for the service-role, OpenAI and Google server keys.
      Verified 29 July: all absent. Re-run after any change to how config is
      loaded.
- [ ] Sign in as a rep on a real handset and complete one visit end to end:
      check in, capture a location, answer a promotion, submit a form, check
      out. **This has never been done against a real rep account.**

## After go-live

- [ ] Watch `public.security_events` for the first week. Any
      `profile.permissions_changed` you did not perform yourself is worth
      investigating immediately.
- [ ] Re-run the security regression suite after any migration that touches
      policies, triggers or grants.
