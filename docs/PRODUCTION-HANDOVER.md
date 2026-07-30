# Production handover — Gold Fortune Merchandising

Status as of **30 July 2026**. This document is the answer to "where is
everything and how do I run it". It is honest about what is finished and what
is not: **the deployment is not complete**, and the outstanding items are
listed with the reason each one is blocked.

Companion documents:

- `docs/DEPLOY-WEB.md` — deploying the web platform, and rolling it back
- `docs/RELEASE-ANDROID.md` — signing key, building and publishing an APK
- `docs/DEPLOYMENT-CHECKLIST.md` — pre-launch checks and cost controls
- `docs/SECURITY-AUDIT.md` — the security model

---

## Where everything lives

| Thing | Where | Notes |
|---|---|---|
| Source code | `github.com/conradbrink/Gold-Fortune-Merch-App` | Private |
| Web platform | **Vercel** — **LIVE** at <https://gold-fortune-merch-app-rnyn.vercel.app> | Next.js 16, root directory `web`, auto-deploys from `main` |
| Database | **Supabase** project `bvbgtsxasttjzlemumwy` | Postgres 17, region **eu-west-3 (Paris)** |
| Authentication | Supabase Auth, same project | Email + password |
| Uploaded files | Supabase Storage, same project | Buckets `visit-photos`, `files`, `app-releases` — **all private** |
| Android APK | Supabase Storage bucket `app-releases`, key `1.0.0/app-release.apk` | Served through `/api/app/android`, never a public URL |
| Download page | <https://gold-fortune-merch-app-rnyn.vercel.app/download> | Public by design |
| Signing keystore | `~/gf-merch-release.jks` on Conrad's Mac, password in his password manager | **Outside the repo.** Losing it means this app can never be updated again |

## Current Android release

| | |
|---|---|
| Version | **1.0.0** (versionCode **1**) |
| Released | 30 July 2026 |
| Size | 41.2 MB |
| Package ID | `com.goldfortune.gf_merch_rep` — permanent |
| Architectures | `arm64-v8a`, `armeabi-v7a` (no `x86_64` — see `RELEASE-ANDROID.md`) |
| Signing certificate | `CN=Conrad Brink, O=Gold Fortune Distribution, C=BW` |
| Certificate SHA-256 | `0b68016543e7fed5ed0433bf8e1c2ed50fdac2be66a96e3b40b4a45305b1f394` |
| APK SHA-256 | `5f7899737c31d2661811eae9885224084fa9de631cd0105c5cb1a5cf5d663244` |
| Forced-update floor | 1 (nobody is locked out) |

**One organisation is active: Gold Fortune.** Every table is scoped by `org_id`
and the multi-tenant structure is intact, so a second company can be added
without migration.

---

## Ongoing costs

| Service | Plan now | Cost | Notes |
|---|---|---|---|
| Supabase | **Free** | $0 | ⚠️ See the warning below — this is not a production-safe plan |
| Vercel | Hobby (once created) | $0 | Hobby is for non-commercial use; **Pro is $20/user/month** and is the correct plan for a company |
| Google Maps / Places / Geocoding | Pay-as-you-go | Usage-based | Has a free monthly allowance. Restrict the keys — see `DEPLOYMENT-CHECKLIST.md` |
| OpenAI (AI insights) | Pay-as-you-go | Usage-based | Set a project budget cap |
| Domain | Your registrar | ~$10–20/year | Vercel issues the HTTPS certificate free |

### ⚠️ The Supabase free plan is a launch risk

Two properties of the free tier matter for a system reps depend on:

1. **There are no automated backups.** Daily backups with 7-day retention start
   on **Pro ($25/month)**. Today the only backup is one you take by hand.
2. **Free projects pause after ~7 days of inactivity.** A paused project means
   reps cannot sign in until someone restores it from the dashboard.
3. **Leaked-password protection cannot be enabled.** It is Pro-only — confirmed
   greyed out on this account, 30 July. Without it, a rep can choose a password
   that already appears in a public breach dump and nothing objects. The only
   floor today is the eight-character minimum in the invite route and the reset
   page.

**Recommendation: upgrade this project to Pro before go-live.** It is the
single highest-value item on this page. Until then, "enable appropriate
database backups" is *not* satisfied, and I have not marked it as such.

---

## Production environment variables

Set in **Vercel → Settings → Environment Variables**. Values are deliberately
not recorded here; they live in `web/.env.local` and in Vercel.

| Name | Public? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase REST endpoint |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Anon key; RLS is the real boundary |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Public | Browser maps; restrict by referrer |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Bypasses RLS; server routes only |
| `OPENAI_API_KEY` | **Secret** | AI insights |
| `OPENAI_MODEL` | Optional | Defaults to `gpt-5.5` |
| `GOOGLE_GEOCODING_API_KEY` | **Secret** | Server-side address lookup |
| `GOOGLE_PLACES_API_KEY` | **Secret** | Server-side place search |

The template with no values is `web/.env.example`.

**Verified**: with all four secrets present in the build environment, none of
them appear anywhere in the compiled output, while the publishable key does —
which is what proves the check was actually looking rather than passing on an
empty build.

---

## How to do things

### Connect your own domain
`docs/DEPLOY-WEB.md` → "Connect a custom domain". Add the domain in Vercel,
create the CNAME it shows you at your registrar. Then update the Google Maps
key restrictions **and** rebuild the Android app with the new URL.

### Create rep accounts
Sign in as a manager → **Representatives → Add rep**. The password is set at
creation, so no invite mailbox is needed. Reps cannot self-register; there is
no public sign-up.

⚠️ Supabase rejects `@goldfortune.dev` addresses but accepts
`@goldfortuneafrica.com`.

### Release a web update
Merge to `main`. Vercel builds and promotes automatically. See
`docs/DEPLOY-WEB.md`.

### Release an Android update
`docs/RELEASE-ANDROID.md`. Raise `versionCode`, build with the release key and
the `--dart-define`, upload the APK, insert the `app_releases` row.

### Roll back
Web: Vercel → Deployments → promote the previous build, then `git revert`.
Android: make the previous release current again — but note reps who already
installed cannot be downgraded, so the real fix is forward.

---

## What is done

- Web app builds clean for production; typecheck passes; no server secret
  reaches the client bundle.
- **Error pages**: branded "temporarily unavailable" and 404 pages with a
  reference id, replacing the raw Next.js screens.
- **Test data cleared**: all 4 fixture visits, their photos, and the empty
  "Gaborone North" sub-territory. **All four accounts kept.** 209 stores, 789
  routes, 209 store assignments, 18 products and the form template are intact.
- **Password reset built** — it did not exist before. Request page, set-new-
  password page, and a link from the sign-in form.
- **Download page** at `/download` with version, date, size, install steps, the
  unknown-sources warning, support guidance and release notes.
- **APK distribution**: private bucket, served through a route. Verified that a
  signed-in rep can neither list the bucket nor fetch an object by exact path,
  with a real object planted to make the test mean something.
- **In-app update check**: optional updates show a dismissible banner;
  postponement is per-version; a minimum version code forces an update. 8 unit
  tests, each confirmed to fail against a deliberately broken implementation.
- **CI** (`.github/workflows/ci.yml`): web typecheck/lint/build, mobile
  analyze/test, and a credential scan — verified to both accept the clean tree
  and reject a planted key.
- **Security suite re-run against production: 26 checks + 25b, all passing**,
  inside a transaction that rolled back. It had been silently broken by the
  country-tier migration and is now fixed.
- **Live API permission tests** as a real rep: cannot promote themselves,
  cannot read the 291-row audit log, cannot read rate-limit counters, cannot
  publish an app release.

## What is NOT done, and why

| Item | Blocked on |
|---|---|
| ~~Web platform is not deployed~~ | **LIVE 30 July** at <https://gold-fortune-merch-app-rnyn.vercel.app> |
| **No custom domain** | Still on the `.vercel.app` address. `DEPLOY-WEB.md` → "Connect a custom domain" |
| ~~No signed APK exists~~ | **Published 30 July.** v1.0.0 (versionCode 1), 41.2 MB, signed `CN=Conrad Brink, O=Gold Fortune Distribution, C=BW` |
| **No APK has been tested on a real device** | There are no physical Android handsets attached to this machine, only the `gf_pixel` emulator (Android 14). Installed and launched cleanly there from the live download URL, but that is **not** the same as a real handset and is not claimed as such |
| **Database backups** | Free plan has none. Needs the Pro upgrade decision |
| **Leaked-password protection** | **Pro-only.** Confirmed greyed out on the Free plan, 30 July. Authentication → Attack Protection. Comes with the Pro upgrade below, not separately |
| ~~`main` is behind~~ | **Resolved 30 July** — PR #2 merged, `main` at `6f2de91`, CI green |
| **Password reset not end-to-end tested** | Sending a real reset email is an outward-facing action I did not take unasked. The pages render and the invalid-link branch is untested in-browser because the test browser held a live session |
| **Manager password still the seeded one** | `GoldFortune2026!` is in `docs/PROJECT-CONTEXT.md` and in git history. **Rotate it.** |

---

## The order to finish in

1. **Rotate the manager password.** It is published in the repo's history.
2. ~~Land PR #2 into `main`.~~ **Done 30 July.** `main` is at `6f2de91` with
   all 40 commits and CI green. It is ready to be the production branch.
3. **Decide on Supabase Pro.** Backups and no auto-pausing.
4. ~~Create the Vercel project~~ — **done 30 July.** All 7 variables set, scoped
   to Production only (one Supabase project means a Preview deployment would
   otherwise write to live data).
5. **Add the site URL to Supabase → Authentication → URL Configuration**, or
   password-reset links are refused on arrival.
6. **Enable leaked-password protection**, and confirm the spend caps.
6. **Create the signing keystore**, back it up, and build the first APK.
7. **Publish release 1.0.0** and confirm `/download` serves it.
8. **Install it on a real phone**, sign in, complete and sync one visit.

Step 8 is the one that decides whether this is finished. Everything before it
is preparation.
