# Security audit — GF Merchandising

Audited 29 July 2026 against the live Supabase project `bvbgtsxasttjzlemumwy`
(eu-west-3). Every finding below was **confirmed by exploiting it** inside a
transaction that was then rolled back, not inferred from reading policy text.

Status: **Phase 1 and 2 complete. Two confirmed vulnerabilities fixed and
re-tested.** Phases 3–11 are scoped at the end and not yet done.

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
| `visit-photos` bucket has no size or MIME limit | `files` has both. An authenticated rep could upload arbitrarily large files or executable types. |
| Leaked-password protection disabled | Supabase Auth can check new passwords against HaveIBeenPwned. Dashboard toggle. |
| No rate limiting anywhere | Nothing throttles check-ins, photo uploads, geocoding, or the OpenAI plan critic. All four cost money or storage. |
| `visits_update` still allows a rep to change `status` freely | They can mark a visit `missed` or reopen a `checked_out` one. Lower impact now that the coordinates are frozen. |
| No audit trail | Role changes, store reassignment and deactivation are not logged anywhere. |

### LOW — outstanding

- Six SECURITY DEFINER functions are callable by `authenticated`. Reviewed:
  all pin `search_path` and validate the caller. `current_org_id` and
  `current_role` **must** be definer to read `profiles`. This is the advisor
  being conservative, not a defect — but `close_abandoned_workday` and
  `set_store_location_from_visit` are worth re-reading whenever they change.
- `rls_forced` is false on every table, so a future table owner bypasses RLS.
  Only relevant if application code ever connects as the owner; it does not.

---

## 3. Not yet done

Phases 3–11 of the brief are **not complete**. In priority order:

1. **Rate limiting** (Phase 6). Nothing exists. Highest remaining risk, because
   it is the one that costs money: geocoding, Maps loads and OpenAI calls are
   all reachable by an authenticated user with no ceiling.
2. **Storage hardening** (Phase 7). Add a size and MIME limit to `visit-photos`;
   verify the per-user path is enforced by policy and not just by the client.
3. **Audit logging** (Phase 9). Role changes, deactivations and assignment
   changes need a trail.
4. **Automated security tests** (Phase 10). The exploits in this document were
   run by hand; they should be a test file that runs in CI.
5. **Cost controls** (Phase 11). Supabase usage alerts, Google Maps budget caps,
   OpenAI spend limits — all dashboard configuration.
6. **Input validation review** (Phase 8) across the server routes.

## 4. Credentials to rotate

None are known to have leaked. `web/.env.local` is gitignored and absent from
git history. Rotate anyway if the laptop has ever been shared.

The **`NEXT_PUBLIC_GOOGLE_MAPS_KEY` is visible in the page source by design** —
it must keep its HTTP-referrer restriction, and it should have a budget cap
(Phase 11).

## 5. Rollback

`20260729171447_lock_privilege_and_gps_fields.sql` is reversible:

```sql
grant update on public.profiles to authenticated;
drop trigger if exists visits_freeze_recorded_position on public.visits;
```

That restores both vulnerabilities, so it is a last resort. Neither change
alters data or schema — only privileges and a trigger.
