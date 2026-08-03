# Rotating credentials

Written 3 Aug 2026, because the contents of `web/.env.local` were printed
unredacted into an AI coding-session transcript. It is a general procedure and
applies to any future rotation.

**Do this yourself.** Every step involves typing a secret into a field, which
is exactly what an assistant should not be doing on your behalf, whatever it
offers.

---

## Before you start: what holds a copy

Only **two** places hold values. This was verified against the tree, not
assumed:

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
5. Verify: sign in and load `/reports`, then run `./scripts/backup-export.sh`
   and confirm it completes rather than 401s.
6. **Then** revoke the old secret key in the same dashboard.

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

## 3. Google — three keys

Google Cloud Console → APIs & Services → Credentials. Google has no in-place
rotation: you create a replacement and delete the old one.

| Key | Restriction it must keep |
|---|---|
| `GOOGLE_GEOCODING_API_KEY` | server-side; restrict to the Geocoding API |
| `GOOGLE_PLACES_API_KEY` | server-side; restrict to the Places API |
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

## 5. While you are in the Vercel dashboard

Preview deployments have failed on every pull request for some time, including
documentation-only ones, while production from `main` deploys fine. The build
reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at
build time, and the pattern fits those variables being scoped to **Production**
but not **Preview**.

This has not been confirmed against a Vercel build log. Since you will be in
the environment-variables screen anyway, it costs nothing to check whether each
variable is ticked for Preview as well as Production.
