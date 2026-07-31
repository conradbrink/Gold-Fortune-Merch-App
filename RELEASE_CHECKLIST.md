# Release checklist

Copy this into the pull request and tick as you go. Anything not ticked is a
question to answer, not a box to skip.

## 1. Before writing code

- [ ] The bug or request is written down
- [ ] **Reproduced.** If it cannot be reproduced, it cannot be shown fixed
- [ ] Decided whether this is a fix (`fix/…`) or a feature (`feature/…`)
- [ ] Branch created from the **latest** `main`

Branch names: `fix/location-not-saving`, `fix/offline-sync`,
`feature/territories`, `feature/unscheduled-visits`.

## 2. Making the change

- [ ] Smallest change that solves the problem — no unrelated refactors,
      renames or design tweaks
- [ ] A test added or updated that **fails without the fix**
- [ ] If a database change is needed:
  - [ ] It is a migration file in `supabase/migrations/`
  - [ ] Filename uses the version the tool reported (see `supabase/README.md`)
  - [ ] No existing migration edited or deleted
  - [ ] Additive where possible — new columns rather than renamed ones
  - [ ] **The previous app version still works against the new schema**, since
        reps' phones update on their own schedule
  - [ ] Data impact written in the PR: what changes, what could be lost
  - [ ] Rollback described

## 3. Checks

- [ ] `npx tsc --noEmit` clean in `web/`
- [ ] `npm run build` succeeds
- [ ] `flutter analyze` and `flutter test` clean in `mobile/`
- [ ] Security suite passes: paste `supabase/tests/security_regression.sql`
      into the SQL editor — it rolls back and must raise
      "ALL SECURITY CHECKS PASSED"
- [ ] All five CI checks green on the PR

## 4. Testing

- [ ] Deployed to staging *(once staging exists)*
- [ ] Relevant sections of `STAGING_TEST_CHECKLIST.md` completed
- [ ] Tested on a real Android phone if the mobile app changed
- [ ] Checked the thing that broke is fixed **and** the things around it still work

## 5. Review and approval

- [ ] Pull request opened, describing what changed and why
- [ ] Diff read line by line — not just the description
- [ ] Every review comment answered or resolved
- [ ] **A recent database backup exists** if this touches the database
- [ ] Owner has approved the merge

## 6. Release

- [ ] Merged into `main` (production deploys automatically)
- [ ] Production smoke test:
  - [ ] `/login` loads
  - [ ] Sign in as a manager works
  - [ ] `/download` loads **without** being signed in
  - [ ] The specific thing that was fixed now behaves correctly
- [ ] Tag and GitHub release created with a version number and notes:
      `git tag -a v1.0.1 -m "…"` then `git push origin v1.0.1`

## 7. If the phone app changed

- [ ] `versionCode` increased in `mobile/pubspec.yaml` — it must only go up
- [ ] Built with `--release`, ARM-only, and `--dart-define=GF_WEB_BASE_URL=…`
- [ ] Build printed "Signing release with the keystore"
- [ ] `apksigner verify --print-certs` shows SHA-256
      `0b68016543e7fed5ed0433bf8e1c2ed50fdac2be66a96e3b40b4a45305b1f394`
- [ ] No `localhost` in the APK
- [ ] Uploaded and published (`docs/RELEASE-ANDROID.md`)
- [ ] Download page shows the new version, date and size
- [ ] **Installed over the previous version on a real phone** — session and
      unsynced visits survived

## 8. Afterwards

- [ ] Watch errors for the first hour, and again next morning
- [ ] Confirm reps can still work — one real check-in end to end
- [ ] If anything looks wrong, `ROLLBACK_PROCEDURE.md`

---

## Stop and ask the owner before

- Changing database structure
- Changing authentication or access rules
- Changing hosting configuration
- Changing the Android signing key
- Adding anything that costs money
- Deleting production data
- Merging into `main`
- Deploying a production release
