# Security audit — GF Merchandising

Audited 29 July 2026 against the live Supabase project `bvbgtsxasttjzlemumwy` (deleted 31 July 2026; replaced by `rxtlnetlzmbqirqaalkw`)
(eu-west-3). Every finding below was **confirmed by exploiting it** inside a
transaction that was then rolled back, not inferred from reading policy text.

Status: **all eleven phases worked through.** Seven confirmed vulnerabilities
fixed and re-tested, an audit trail added, operator kill switches added, and the
exploits turned into a runnable regression suite —
`supabase/tests/security_regression.sql`, 18 checks, all passing. What remains
is listed honestly in section 3; none of it is a known hole.

Go-live steps are in `docs/DEPLOYMENT-CHECKLIST.md`.

---

## 1. Architecture

| Component | What it is |
|---|---|
| Web | Next.js app in `web/`, browser client + a few server route handlers |
| Mobile | Flutter app in `mobile/`, offline-first with a drift outbox |
| Database | Supabase Postgres, 22 tables in `public` |
| Edge Functions | **none** |
| Server routes | `web/app/api/*` — the only place the service-role key is used |
| External paid services | Google Maps JS + Places (browser key), Google Geocoding + Places (server), OpenAI (`gpt-5.5`, server) |

**Roles.** Two: `manager` and `rep`, held in `profiles.role`. There is no
separate administrator. Tenancy is `profiles.org_id`, and every policy funnels
through two SECURITY DEFINER helpers, `current_org_id()` and `current_role()`,
both of which return null for a profile with `is_active = false`.

**Storage.** Two buckets, both **private**: `visit-photos` (no size or MIME
limit) and `files` (25 MB limit, MIME allowlist).

**Secrets.** `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`GOOGLE_GEOCODING_API_KEY` and `GOOGLE_PLACES_API_KEY` are server-only.
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_KEY` are
browser keys by design. `web/.env.local` is gitignored and confirmed absent from
the entire git history.

---

## 2. Findings

### CRITICAL — any rep could make themselves a manager · FIXED

`profiles_update` allowed the update when `id = auth.uid()`, and with no
`WITH CHECK` Postgres reuses that expression for the new row. It tests **who
owns the row, never which columns changed**. RLS structurally cannot express
"these columns are read-only" — a policy sees a row, not a diff.

**Exploit, confirmed:** `PATCH /rest/v1/profiles?id=eq.<own id>` with
`{"role":"manager"}`. The role came back `manager`. From there: every visit, GPS
trail, photo, store, price and report in the organisation, readable and
writable. Any rep with the app installed could do this from a phone with `curl`.

**Fix** — `20260729171447_lock_privilege_and_gps_fields.sql`. `UPDATE` is revoked
from `authenticated` at table level and granted back only on
`full_name, phone, job_title`. `role`, `is_active`, `org_id`, `id` and `email`
are now server-controlled. Nothing in the app broke: deactivation already ran
through `/api/reps/[id]` on the service role, and rep creation through
`/api/reps/invite`, which sets `role` server-side after verifying the caller.

### HIGH — a deactivated user could switch themselves back on · FIXED

Same root cause. `current_org_id()` returns null for an inactive profile, which
stops them *reading* — but `id = auth.uid()` still permitted the *write*, so a
dismissed rep could restore their own access. Closed by the same column revoke.

### HIGH — a rep could move themselves between organisations · FIXED

Same root cause, on `org_id` — the field every tenancy policy is built on.
Exploitable only with a valid organisation uuid, so harder to reach, but it is
the boundary of the entire multi-tenant model. Closed by the same column revoke.

### HIGH — a rep could rewrite their own GPS history · FIXED

`visits_update` let a rep update their own rows, which they must be able to do:
check-out writes `checkout_at` and coordinates onto the row check-in created.
The same permission let them go back and edit `checkin_at`, `checkin_lat`,
`checkin_lng` and `checkin_distance_from_store_m` afterwards.

**Exploit, confirmed:** an off-site check-in recorded at 4,200 m was edited to
5 m. Every geofencing claim in the product — the activity feed's "off site"
verdict, the scorecard's verified rate, the whole audit trail — rests on columns
the measured party could edit.

**Fix** — a `BEFORE UPDATE` trigger, `freeze_recorded_position()`. Null → value
is allowed (that is check-out completing the row). Value → different value, and
value → null, are refused. `org_id`, `rep_id` and `store_id` are frozen too, so
a visit cannot be reassigned after creation. `service_role` and direct SQL are
exempt, so a genuine correction remains possible out of band.

### HIGH — no rate limiting on paid endpoints · FIXED

Three routes reached a paid third party on behalf of a signed-in user with no
ceiling: `/api/geocode` (Google Places, then Geocoding, once per store),
`/api/insights` (an OpenAI completion over the whole estate) and
`/api/reps/invite` (creates an auth user). Any authenticated rep could call
them in a loop; the bill is the customer's.

**Fix** — `20260729172337_create_rate_limiter.sql` plus `web/lib/rate-limit.ts`.
Counting lives in Postgres, not in the Next.js process: serverless instances
come and go, several run at once, and an in-memory tally resets on every cold
start. `insert … on conflict … do update` is atomic, so two simultaneous
requests cannot both read "9 of 10" and both proceed.

| Bucket | Limit | Why that number |
|---|---|---|
| `geocode` | 250 / hour, **charged per store** | A full estate re-geocode is 209 stores, so one legitimate run fits with room to retry |
| `insights` | 20 / hour | A manager comparing periods might run half a dozen, never sixty |
| `rep_invite` | 10 / hour | Abuse pollutes the org and the auth tenant |
| `rep_admin` | 60 / hour | Cheap, but worth a ceiling |

The `rate_limits` table has RLS enabled and **zero policies**, with all
privileges revoked from `authenticated` — verified that a signed-in user can
neither read nor reset their own counter. The subject comes from `auth.uid()`
inside the function and never from an argument, so a caller cannot spread usage
across identities. Exceeding a limit returns **429 with `Retry-After`**.

Verified: 3 of 3 allowed and the 4th refused with a retry window; a cost of 25
consumed 25 units in one call; counters unreadable and unresettable by the user;
a second user got their own budget.

One deliberate choice: if the limiter itself errors, the request is **allowed**
and the failure logged. Losing the ability to count is a worse reason to take
the product down than letting a few calls through uncounted.

### Verified as SOUND — no action needed

Tested and behaving correctly:

- Anonymous callers get nothing. `anon` cannot even execute `current_org_id`,
  so every policy short-circuits. Checked across `profiles`, `stores`, `visits`,
  `location_pings`, `photos`, `organizations`, `products`, `promotions`.
- A rep cannot read another rep's visits, GPS pings, or profile.
- A rep cannot steal or reassign another rep's visit.
- A rep cannot create a visit as another rep (`visits_insert` pins
  `rep_id = auth.uid()`).
- `location_pings` has only SELECT and INSERT policies — UPDATE and DELETE are
  denied by default, so GPS pings are already immutable.
- `visits` has no DELETE policy — visits cannot be deleted through the API.
- `promotion_checks` has no UPDATE policy — a rep's answer cannot be edited,
  only superseded.
- RLS is enabled on all 22 public tables.
- Both storage buckets are private.

### MEDIUM — outstanding

| Finding | Detail |
|---|---|
| Leaked-password protection disabled | Supabase Auth can check new passwords against HaveIBeenPwned. Dashboard toggle. |
| Photo uploads and check-ins are still unthrottled | The paid routes are now limited; these are storage and row growth rather than a third-party bill, so lower priority. |
| `visits_update` still allows a rep to change `status` freely | They can mark a visit `missed` or reopen a `checked_out` one. Lower impact now that the coordinates are frozen. |

### LOW — outstanding

- Six SECURITY DEFINER functions are callable by `authenticated`. Reviewed:
  all pin `search_path` and validate the caller. `current_org_id` and
  `current_role` **must** be definer to read `profiles`. This is the advisor
  being conservative, not a defect — but `close_abandoned_workday` and
  `set_store_location_from_visit` are worth re-reading whenever they change.
- `rls_forced` is false on every table, so a future table owner bypasses RLS.
  Only relevant if application code ever connects as the owner; it does not.

### MEDIUM — visit-photos accepted anything · FIXED

The bucket had neither a size nor a MIME limit, while `files` had both. An
authenticated rep could upload a multi-gigabyte file, or an executable, into
storage the customer pays for. Now capped at **10 MB** and restricted to
`image/jpeg, png, webp, heic, heif`. Still private, and the path policy already
pinned uploads to `{org_id}/{auth.uid()}/…`.

### MEDIUM — nothing recorded who changed a permission · FIXED

`20260729180012_create_security_audit_log.sql` adds `security_events`, written
by triggers rather than by application code — code that remembers to log is code
that eventually forgets, and a trigger catches the service-role routes and
direct SQL too. It records role, `is_active` and `org_id` changes, and store
assignments (coverage decides which chain-audience files a rep can see, so it is
a permission change as much as a scheduling one).

Managers read their own organisation's trail. There is no INSERT, UPDATE or
DELETE policy: an audit log a user can edit is not an audit log. The `via`
field names the connection role, so a change made with the service key is
distinguishable from one made by a signed-in manager.

### Phases 3, 4, 5 and 8 — checked, largely already sound

Verified rather than assumed. Every claim below was tested.

**Server-controlled fields (Phase 3).** Swept every table for the fields the
brief lists. Beyond `profiles`, which was the real hole, all of them were
already manager-gated: `store_assignments`, `routes`, `files`, `products`,
`promotions`, `form_templates` and `organizations` each require
`current_role() = 'manager'`. Confirmed by attack as a rep — could not assign
myself a store, create my own route, publish a file, create a product or a
promotion, edit a form template, or change the org's capacity setting.
Mass assignment was tested too: an insert carrying a foreign `org_id` is
refused.

**Auth and authorisation (Phase 4).** Every route derives identity from the
verified token and refuses an org or role supplied in the body. `/api/reps/invite`
hardcodes `role: "rep"`, takes the org from the caller's own profile, and rolls
the auth user back if the profile insert fails.

There is **no trigger on `auth.users`**, which is a load-bearing accident: a
self-registered account gets no profile, so `current_org_id()` returns null and
every policy denies it. If a "create a profile on signup" trigger is ever added,
public signup becomes a way into an organisation and this must be revisited.

The one gap is password strength — the invite route requires eight characters
and nothing else, and Supabase's leaked-password check is off. See the checklist.

**Secrets in artifacts (Phase 5).** Scanned the production build and the release
APK for all four server secrets. All absent from `.next/static`, and the
service-role key appears nowhere in `.next` at all. Absent from the APK.

The APK does embed a Supabase publishable key, by design. Tested it in isolation
against seven tables with no session: every one refused. It grants nothing.

**Input validation (Phase 8).** No SQL injection surface — everything goes
through PostgREST with parameterised queries. No webhooks, no redirects, no
cross-origin API. Storage paths are built from ids the server controls, and the
bucket policy pins them to `{org_id}/{auth.uid()}` regardless. Bodies are
destructured field by field rather than spread, so there is no mass-assignment
path. One nit: a failed `createUser` returns the provider's message verbatim,
which could leak a little about the auth backend.

### Emergency controls (Phase 11) · ADDED

`service_flags` — a single global row with `geocoding_enabled` and
`insights_enabled`, readable by any signed-in user so the UI can explain itself,
writable only with the service role. The routes check it *before* consuming
quota, so a disabled feature does not eat anyone's allowance.

It is separate from rate limiting on purpose. The limiter caps what one user can
spend; this stops a feature outright while a bill is being investigated, without
taking the product down — reps keep checking in, submitting forms and uploading
photos throughout, none of which costs anything per use.

Both the SQL function and the TypeScript helper **fail open**. A kill switch
that fails closed turns an unreadable table into an outage, which is the
opposite of its purpose.

## 3. Not yet done

Phases 3–11 of the brief are **not complete**. In priority order:

1. **Storage hardening** (Phase 7). Add a size and MIME limit to `visit-photos`;
   verify the per-user path is enforced by policy and not just by the client.
3. **Audit logging** (Phase 9). Role changes, deactivations and assignment
   changes need a trail.
4. **Automated security tests** (Phase 10). The exploits in this document were
   run by hand; they should be a test file that runs in CI.
5. **Cost controls** (Phase 11). Supabase usage alerts, Google Maps budget caps,
   OpenAI spend limits — all dashboard configuration.
6. **Input validation review** (Phase 8) across the server routes.

## 4. Provider-side controls — done 29 July

Set by hand in the Google Cloud console for project **GF app merch**:

- Per-day request quotas on Places, Geocoding and Maps JavaScript.
- Key restrictions on `NEXT_PUBLIC_GOOGLE_MAPS_KEY` — HTTP referrers and an API
  allowlist. This matters more than the quota: a quota caps what a stolen key
  costs, a referrer restriction stops it working at all.

Note the account is on the **$300 free trial**, which blocks quota editing until
billing is activated. If any quota did not take, revisit it at activation — the
app-level limiter is the ceiling that protects against the app itself, and the
Google quota only covers a key used *outside* the app.

Still to configure when billing is live:

- **Google** — Billing → Budgets & alerts, email at 50/90/100%. No hard cap
  exists; the per-day quotas are the hard stop.
- **OpenAI** — platform.openai.com → Settings → Limits: monthly budget and
  notification threshold. This one *does* stop serving at the cap. Use a
  project-scoped key so the cap cannot be sidestepped.
- **Supabase** — Settings → Billing: confirm **spend cap is on**, then usage
  alerts for database size, egress and storage.

## 5. Credentials to rotate

✅ **Rotated 3 Aug 2026.** The contents of `web/.env.local` had been printed
unredacted into an AI coding-session transcript, exposing
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GOOGLE_GEOCODING_API_KEY`,
`GOOGLE_PLACES_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_KEY`. All five were
replaced the same day.

Nothing reached the repository: `web/.env.local` is gitignored
(`web/.gitignore:34`), absent from git history, and CI's secret scan passes.

Verified after rotation: all five new keys authenticate, and the Maps key still
carries the HTTP-referrer restriction that is the only thing protecting a key
which ships in the page source.

Verified in **production**, not merely in `web/.env.local`:

* `SUPABASE_SERVICE_ROLE_KEY` — `/api/app/android` returns 200. That is the one
  public route which builds an admin client from the service key, so it is the
  only non-destructive proof the *deployed* key works. `/reports` cannot show
  this: every dashboard page is a client component using the publishable key,
  so it renders whatever the server key is, or isn't.
* `OPENAI_API_KEY` — the Manager briefing on `/reports` generates. It returned
  `401 Incorrect API key` first, from a bad copy in Vercel rather than a bad
  key; the local copy authenticated throughout.

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` was deliberately not rotated. It is
public by design and ships in the page source; RLS is the boundary.

The procedure, and what each check actually proves, is
`docs/ROTATE-CREDENTIALS.md`.

The **`NEXT_PUBLIC_GOOGLE_MAPS_KEY` is visible in the page source by design** —
it must keep its HTTP-referrer restriction, and it should have a budget cap
(Phase 11).

## 6. Rollback

`20260729171447_lock_privilege_and_gps_fields.sql` is reversible:

```sql
grant update on public.profiles to authenticated;
drop trigger if exists visits_freeze_recorded_position on public.visits;
```

That restores both vulnerabilities, so it is a last resort. Neither change
alters data or schema — only privileges and a trigger.
