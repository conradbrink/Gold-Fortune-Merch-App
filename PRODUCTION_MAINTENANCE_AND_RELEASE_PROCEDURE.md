# How this system is maintained

Plain language, for the business owner. No prior technical knowledge assumed.

If you read only one thing, read **"Things that must never be done directly in
production"** at the bottom.

---

## The three environments

| | What it is | Who uses it | Where |
|---|---|---|---|
| **Development** | A copy running on a developer's own laptop | Whoever is building a change | Not on the internet |
| **Staging** | A rehearsal copy of the real thing | Us, to test before you see it | ⚠️ *not built yet — see below* |
| **Production** | The real system your team uses | Gold Fortune staff | <https://gold-fortune-merch-app-rnyn.vercel.app> |

**Production is the only one with real data in it.** Development and staging
use made-up stores and test accounts.

> ⚠️ **Staging does not exist yet.** Building it needs a second Supabase
> organisation on the free plan, which you must create (a second project inside
> the current paid organisation would cost $10/month). Until it exists, changes
> are tested on a developer's laptop and then go to production — which works,
> but there is no rehearsal step.

---

## How to report a bug

Open an issue on GitHub and fill in the template — it appears automatically.
Or send the same information any way you like; the template is just a reminder
of what we need.

The fields that matter most, because without them a bug often cannot be found:

- **What you expected** versus **what actually happened**
- **Which app** — the website or the phone app
- **The app version** (phone app: it is on the download page; website: just say
  "the website today")
- **Steps to make it happen again**, and whether it happens every time
- **Whether any information was lost or changed**

A screenshot or a short screen recording is worth more than a paragraph.

**If data was lost or the app is unusable for the whole team, say so
immediately.** That changes it from "we will fix it this week" to "we are
looking at it now".

---

## How a fix gets made

1. The bug is written down and reproduced — if we cannot make it happen, we
   cannot know we have fixed it.
2. A **branch** is created. Think of it as a photocopy of the system that can
   be scribbled on without touching the original.
3. The smallest change that fixes the problem is made. Not a redesign.
4. A test is added, so the same bug cannot come back unnoticed.
5. **Automatic checks run** (see below).
6. The change is tested — on staging once it exists.
7. A **pull request** is opened. This is the formal proposal: "here is exactly
   what I want to change".
8. You approve it.
9. It merges into `main`, and production updates automatically.
10. A version number and release note are recorded.
11. We check production still works, and watch for errors.

**Nothing reaches production except through this path.** The system now
enforces that — see below.

---

## What runs automatically on every proposed change

Five checks. If any of the required ones fail, **GitHub will not let the change
merge** — it is not a matter of remembering.

| Check | What it protects against |
|---|---|
| Web build, typecheck, lint | Website code that does not compile or has type errors |
| Mobile analyze and test | Phone app code that does not compile; 53 automated tests |
| No secrets in the tree | A password or API key accidentally committed |
| Dependency audit | Known security holes in third-party code |
| Migration safety | Database change files being edited after they have been applied |

Two honest caveats:

- **Lint currently reports rather than blocks.** There are 28 pre-existing
  style errors. Blocking on them would make every change fail from day one,
  which teaches everyone to ignore the gate. The number is printed on every run
  so it can be driven down.
- **The dependency audit blocks on "critical" only.** There are 12 "high"
  advisories today, almost all in build tooling that never reaches a user. The
  one that matters is `sharp` (image processing). Gating at "high" would block
  everything immediately.

---

## How production is approved and released

**Only you approve a production release.** In practice that means: you say yes
on the pull request, or you say yes in conversation.

Production deploys **automatically** when a change reaches `main`. That is why
`main` is protected:

- Nobody can push straight to it — a pull request is required
- The checks above must pass
- It cannot be force-overwritten or deleted
- These rules apply to everyone, including the account owner

This has been tested by deliberately trying to push directly and being refused.

---

## How version numbers work

Format `v1.2.3`:

- **First number** — a big change; things may work differently
- **Second number** — new features, nothing broken
- **Third number** — bug fixes only

The phone app has a second, invisible number called the **version code**, which
only ever counts up: 1, 2, 3. Android uses it to decide what is newer. It can
never go backwards, which is why a broken phone release is fixed by releasing a
*newer* version, not by putting the old one back.

**Current production version: `v1.0.0`.**

---

## How to roll back

Full detail in `ROLLBACK_PROCEDURE.md`. The short version:

- **Website** — Vercel keeps every previous version built and ready. Promoting
  yesterday's version takes seconds.
- **Phone app** — the previous APK can be made current again for *new*
  downloads, but reps who already updated cannot be moved backwards. A bad
  phone release is fixed by shipping a fix forward.
- **Database** — restoring is a bigger decision, because it means losing
  everything recorded since the backup. Never done casually.

⚠️ **Rolling the code back does not roll the database back.** If a release
changed the database and you undo only the code, you get old code talking to a
new database. That combination causes worse problems than the original bug.
Always ask: "did this release change the database?"

---

## How to confirm backups exist

Full detail in `BACKUP_AND_RESTORE_PROCEDURE.md`.

Supabase → your project → **Database → Backups**. You should see one entry per
day. If the newest is more than about 48 hours old, something is wrong.

⚠️ **Backups cover the database, not the photos.** Supabase says so on that
page. Visit photos are evidence of a rep having been at a store, and they are
not reproducible if lost.

---

## Who owns what

| Service | What it holds | Owner |
|---|---|---|
| **GitHub** | All source code and history | `conradbrink` |
| **Vercel** | The website hosting | Team `gold-fortune1` |
| **Supabase** | Database, logins, photos, the APK | Org `Cons Org` (Pro, $25/mo) |
| **Google Cloud** | Maps and address lookup keys | Your Google account |
| **OpenAI** | AI insights | Your OpenAI account |
| **Android signing key** | Proof the app is genuinely yours | `~/gf-merch-release.jks` + password manager |

**You should hold the recovery details for all of these**, and be the account
owner rather than a member. The signing key is the one that cannot be replaced:
lose it and the app can never be updated again — only replaced with a new one
that every rep must install by hand.

---

## Things that must never be done directly in production

1. **Never edit data in the Supabase table editor to "fix" something.** It
   leaves no record, no undo, and the app may depend on the shape you changed.
2. **Never change the database structure in the dashboard.** Every change must
   be a migration file in GitHub, or the next environment built will not match.
3. **Never edit a migration file that has already run.** Add a new one.
4. **Never push straight to `main`.** The system blocks this; do not disable it.
5. **Never put a password or key in the code.** They go in the hosting
   platform's environment settings.
6. **Never use the production service-role key anywhere near a browser or the
   phone app.** It bypasses every access rule.
7. **Never delete or rename a database column without a confirmed backup and
   explicit approval.** Old app versions on reps' phones may still be using it.
8. **Never change the Android signing key.**
9. **Never test on production data.** That is what staging is for.

---

## Related documents

| File | Purpose |
|---|---|
| `RELEASE_CHECKLIST.md` | Step-by-step for shipping a change |
| `ROLLBACK_PROCEDURE.md` | Undoing a bad release |
| `BACKUP_AND_RESTORE_PROCEDURE.md` | What is backed up, and how to restore |
| `STAGING_TEST_CHECKLIST.md` | What to test before a release |
| `BUG_REPORT_TEMPLATE.md` | What to include in a bug report |
| `docs/DEPLOY-WEB.md` | Technical: website deployment |
| `docs/RELEASE-ANDROID.md` | Technical: building and signing the APK |
| `docs/PRODUCTION-HANDOVER.md` | Technical: current state of everything |
