# Rotating credentials

Written 3 Aug 2026, because the contents of `web/.env.local` were printed
unredacted into an AI coding-session transcript. It is a general procedure and
applies to any future rotation.

**Do this yourself.** Every step involves typing a secret into a field, which
is exactly what an assistant should not be doing on your behalf, whatever it
offers.

---

## Before you start: what holds a copy

Only **two** places hold a *copy* you have to go and change. This was verified
against the tree, not assumed.

The provider is the third holder and behaves differently: Supabase, OpenAI and
Google each keep the authoritative record, and that is where a key is created
and revoked rather than edited. A copy updated everywhere below still leaves
the old key working until it is revoked at the provider — which is the step
people skip, because everything appears to work without it.

| Where | What |
|---|---|
| **Vercel → Settings → Environment Variables** | every key, per environment |
| **`web/.env.local`** on the developer laptop | every key |

Nothing else. Specifically:

- **GitHub Actions holds no secrets.** No workflow in `.github/workflows/`
  references `secrets.*` at all.
- **The Flutter app holds none of these.** `mobile/lib/core/env.dart` carries
  only `GF_WEB_BASE_URL`; the Sentry DSN arrives at build time as a
  `--dart-define`. No rebuild or new APK is needed.
- **`scripts/backup-export.sh` needs no edit.** It reads `web/.env.local`
  (line 21), so it picks up whatever is there.

## Done 3 Aug 2026

All five keys were rotated. Verified afterwards: every new key authenticates,
the Maps key still carries its HTTP-referrer restriction, and production
returns 200 from `/api/app/android`, which is the only non-destructive proof
the *deployed* service key works.

Two things this round taught, kept because both cost time:

- **A dashboard page is not a check on the server key.** The first version of
  this runbook said to verify with `/reports`. Every dashboard page is a client
  component using the publishable key, so it renders identically whether the
  service key is right, wrong or absent — offered immediately before an
  irreversible revoke. Use the `curl` in §1 step 5.
- **Rotating and revoking are different days' work.** A new key that coexists
  with the old one closes nothing. The exposure ends at the revoke, and
  everything keeps working if you skip it, which is why it gets skipped.

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is not on the list and does not need to
be: it is public by design and ships in the page source.

Update this table as each one is finished, and delete it once they all are.

## The order that matters

Create the new key → update Vercel → update `web/.env.local` → verify →
**only then** revoke the old one.

Revoking first takes production down for as long as the gap lasts. There is no
reason to hurry that step; two keys living for ten minutes is not the risk.

---

## 1. Supabase — `SUPABASE_SERVICE_ROLE_KEY`

Do this one first. It is the one that bypasses RLS, so it is the one that
matters.

**Good news, and worth knowing before you click:** this project uses the newer
`sb_secret_…` / `sb_publishable_…` API keys, not the legacy JWT `anon` /
`service_role` pair. That means:

- The secret key rotates **independently**. Nobody is signed out.
- Had these been legacy JWTs, rotating would have re-signed the JWT secret and
  **logged out every rep in the field mid-round**. That is not the situation.

Steps — Supabase Dashboard → Project `rxtlnetlzmbqirqaalkw` → Settings → API
Keys:

1. Create a **new secret key**. Copy it once; it is not shown again.
2. Vercel → Settings → Environment Variables → `SUPABASE_SERVICE_ROLE_KEY` →
   set the new value for **every environment it is set in** (see §5 — Preview
   may be why preview deployments fail).
3. Update `SUPABASE_SERVICE_ROLE_KEY` in `web/.env.local`.
4. Redeploy production so the running instance picks it up. An env-var change
   alone does not restart it.
5. Verify **production**, with a request that actually uses the server key:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' \
     https://gold-fortune-merch-app-rnyn.vercel.app/api/app/android
   ```

   `200` means the deployed instance built its admin client and read from
   Supabase storage — which is only possible with a working
   `SUPABASE_SERVICE_ROLE_KEY`. `503` means the variable is missing. `502`
   means the key works but the release file is absent, which is a different
   fault and still proves the key.

   ⚠️ Do **not** verify with `/reports`. Every dashboard page is a client
   component using the browser client and the *publishable* key, so it renders
   perfectly while the server key is wrong or missing. The only server paths
   that touch the service key are `/api/reps/invite`, `/api/reps/[id]` — both
   destructive — and `/api/app/android`, which is a harmless read and public.

6. Optionally also run `./scripts/backup-export.sh`. That checks the copy in
   `web/.env.local`, which is a *different* copy from the one Vercel holds —
   useful, but not a production check.
7. **Then** revoke the old secret key in the same dashboard.

Until step 7 the old key is still live and still bypasses RLS: creating a
replacement does not weaken it. Keep the overlap to minutes, not days, and do
not treat the exposure as closed until the old key is gone.

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` does **not** need rotating. It is public
by design — it ships in the page source, and RLS is the real boundary. Leave it
alone unless you want the churn.

## 2. OpenAI — `OPENAI_API_KEY`

`platform.openai.com` → API keys.

1. Create a new secret key.
2. Update Vercel and `web/.env.local`.
3. Redeploy, then confirm the AI insights panel still returns a result.
4. Delete the old key.

Check **Usage** for the exposure window while you are there. Unexpected spend
is the signal that the key was actually used, not merely exposed.

## 3. Google — four keys

Google Cloud Console → APIs & Services → Credentials. Google has no in-place
rotation: you create a replacement and delete the old one.

| Key | Restriction it must keep |
|---|---|
| `GOOGLE_GEOCODING_API_KEY` | server-side; restrict to the Geocoding API |
| `GOOGLE_PLACES_API_KEY` | server-side; restrict to the Places API |
| `GOOGLE_ROUTES_API_KEY` | server-side; restrict to the Routes API. Billed per request, so rotate it the moment it is suspected rather than at the next convenient time |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | **HTTP referrer restriction** — this one is public by design and visible in the page source. The referrer restriction is the only thing protecting it. Do not create the replacement unrestricted. |

For each: create → apply the same API and referrer restrictions as the old one
→ update Vercel and `web/.env.local` → redeploy → verify (a store map renders,
an address lookup resolves) → delete the old key.

Set a **budget cap** while you are in there if there isn't one.

---

## 4. Afterwards

- Update the date in `docs/SECURITY-AUDIT.md` §5.
- `web/.env.local` is gitignored and must stay that way. Do not commit it, and
  do not paste it into a chat, a terminal that is being recorded, or an issue.
- If you want a record of *when* rotation happened, put the date here. Never
  the values.

## 5. While you are in the Vercel dashboard — the failing previews

Preview deployments have failed on every pull request for some time, including
documentation-only ones, while production from `main` deploys fine.

**The mechanism is reproduced.** Removing `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and running `npx next build` fails the
same way every time:

```
Error: @supabase/ssr: Your project's URL and API key are required to
create a Supabase client!
Export encountered an error on /(dashboard)/inventory/adjustments/page
⨯ Next.js build worker exited with code: 1
```

Next prerenders the dashboard pages at build time, and `createClient` needs
both variables to exist while it does. A build environment without them cannot
succeed, whatever is in the diff — which matches previews failing on
documentation-only pull requests.

**Diagnosed and fixed on 3 Aug 2026.** The dashboard showed every variable in
the project scoped to **Production only**, including both of the two the build
reads — so the Preview environment had neither, which is the reproduced failure
exactly. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
were then ticked for Preview, and the next pull-request build went green.

Kept here because the failure took weeks to explain and the same symptom will
return the moment a new build-time `NEXT_PUBLIC_*` variable is added for
Production alone. Both values are public — the publishable key ships in the
page source by design — so scoping them to Preview widens no secret.
