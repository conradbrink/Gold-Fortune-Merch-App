# Deploying the web platform

The management platform is a Next.js 16 app in `web/`. Production hosting is
**Vercel**, deploying automatically from the `main` branch of
`conradbrink/Gold-Fortune-Merch-App`.

Nothing about the database changes when the web app deploys — Supabase is a
separate service and is not redeployed. See `docs/RELEASE-ANDROID.md` for the
Android side, which is also independent.

---

## One-time setup

Do this once. Afterwards, deployment is just merging to `main`.

### 1. Connect the repository

1. Sign in at <https://vercel.com> with the GitHub account that owns the repo.
2. **Add New → Project**, and import `Gold-Fortune-Merch-App`.
3. Set **Root Directory** to `web`. This is the only setting that must be
   changed — the repository has the mobile app and migrations alongside the web
   app, and Vercel defaults to the repository root, where there is no Next.js
   app to build.
4. Framework preset should auto-detect as **Next.js**. Leave the build and
   install commands alone.

### 2. Set the environment variables

**Settings → Environment Variables.** Add every name in `web/.env.example`,
with the real values from `web/.env.local`. Apply them to **Production**,
**Preview** and **Development** unless noted.

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Public. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | Public. Safe in the browser; RLS is the real boundary. |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | all | Public, and **must** be restricted by HTTP referrer in Google Cloud. |
| `SUPABASE_SERVICE_ROLE_KEY` | all | **Secret.** Bypasses RLS entirely. |
| `OPENAI_API_KEY` | all | **Secret.** Use a project-scoped key with its own budget. |
| `OPENAI_MODEL` | optional | Defaults to `gpt-5.5` when unset. |
| `GOOGLE_GEOCODING_API_KEY` | all | **Secret.** Server-side only. |
| `GOOGLE_PLACES_API_KEY` | all | **Secret.** Server-side only. |
| `GOOGLE_ROUTES_API_KEY` | all | **Secret.** Server-side only. Enable the Routes API in Google Cloud, restrict the key to it, and set a budget alert — this one bills per request. Unset means road distance returns 503. |

⚠️ **Never prefix a secret with `NEXT_PUBLIC_`.** That prefix compiles the
value into the JavaScript every visitor downloads. This has been verified for
the current build: with all secrets present in the build environment, none of
the five secret keys appear anywhere in the output, while the publishable key
does — which is how you know the check is actually looking.

### 3. Set the production branch

**Settings → Git → Production Branch → `main`.**

Every other branch produces a *preview* deployment on its own URL, which is
what makes a pull request reviewable before it reaches anyone.

### 4. Connect a custom domain

**Settings → Domains → Add.** Enter the domain or subdomain, e.g.
`app.goldfortuneafrica.com`.

Vercel then shows the DNS record to create at your registrar — normally a
`CNAME` from your subdomain to `cname.vercel-dns.com`. Add it there, and Vercel
issues and renews the HTTPS certificate automatically. Propagation is usually
minutes; allow up to 24 hours.

**After the domain is live, two things must be updated:**

1. **Google Cloud → Credentials → the browser Maps key** → add the new domain
   to the website restrictions, or maps will silently stop rendering.
2. **The Android app's download URL.** `Env.webBaseUrl` in
   `mobile/lib/core/env.dart` still carries the placeholder `*.vercel.app`
   default. Every release build must pass the real domain — see
   `docs/RELEASE-ANDROID.md`.

---

## Deploying a change

1. Branch off `main`, commit the work, and open a pull request.
2. CI (`.github/workflows/ci.yml`) runs: web typecheck, lint and build; mobile
   analyze and test; and a scan for committed credentials. Vercel posts a
   preview URL on the PR.
3. Check the preview URL.
4. Merge to `main`. Vercel builds and promotes it automatically. No command is
   run by hand, and there is no step where a person deploys from a laptop.

**Never run `npm run dev` as production.** The development server is
single-process, unoptimised, has no HTTPS and rebuilds on every request.

---

## Rolling back

A bad deployment is reverted from Vercel's dashboard, not by fixing forward
under pressure.

1. **Vercel → the project → Deployments.**
2. Find the last deployment known to be good.
3. **⋯ → Promote to Production** (older UIs call this *Rollback*).

The previous build is restored in seconds because it was never deleted — it is
still built and sitting there.

**Then fix the branch properly:**

```bash
git revert <bad-commit-sha>
git push origin main
```

Reverting on `main` is what stops the next unrelated merge from silently
re-deploying the broken build on top of your rollback.

### What a rollback does *not* undo

- **Database migrations.** Supabase is not part of the deployment. If the bad
  release included a migration, rolling the web app back leaves the new schema
  in place. Write migrations so the *previous* app version still works against
  them — add columns, don't rename or drop them in the same release that starts
  using them.
- **Data written by the bad version.** Restoring the code does not remove rows
  it created. See the backup section in `docs/DEPLOYMENT-CHECKLIST.md`.

---

## Health checks after a deploy

- `https://<domain>/login` loads and shows the Gold Fortune sign-in form.
- Signing in as a manager reaches the dashboard.
- `https://<domain>/download` loads **without** a session — it is public by
  design, so reps can install the app before they can sign in.
- **Vercel → Logs** shows no server errors on first load.

If the site is down, the error pages (`web/app/error.tsx` and
`web/app/global-error.tsx`) show a branded "temporarily unavailable" panel with
a reference id rather than a stack trace.
