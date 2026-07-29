# Gold Fortune Merchandising — Project Context

Handoff document. Read this first in a new session.

**Project root:** `/Users/conradbrink/Downloads/GF Merchandising/`

---

## 1. What this is

An FMCG merchandising management platform for **Gold Fortune**, modelled on
[Repsly](https://www.repsly.com/). Two apps against one Supabase backend:

| Part | Path | Who uses it |
|---|---|---|
| Manager web dashboard | `web/` (Next.js) | Managers — stores, schedules, forms, reporting |
| Field rep mobile app | `mobile/` (Flutter) | Reps — visits, check-in/out, forms, photos |
| Reference material | `Reference/` | Repsly product-tour screenshots + `Gold Fortune Logo.png` |

Original build plan: `/Users/conradbrink/.claude/plans/i-want-to-build-compressed-wolf.md`

### Locked-in decisions (do not re-litigate)
- **Mobile = Flutter** (user chose this over React Native)
- **Backend = Supabase** (no custom API server)
- **Offline-first is a hard requirement** for the rep app
- **Multi-tenant from day one** — every table has `org_id`, enforced by RLS

### Brand
Navy `#16224F`, gold `#E0B84B`, red for alerts/missed. Logo lives at
`Reference/Gold Fortune Logo.png` (copied into `web/public/logo.png` and
`mobile/assets/logo.png`).

---

## 2. Supabase

- **Project ref:** `bvbgtsxasttjzlemumwy` (region eu-west-3)
- **Org:** `xisdimcaejfxkmogsamf` ("Cons Org") — **Free plan**
- **URL:** `https://bvbgtsxasttjzlemumwy.supabase.co`
- **Publishable key:** `sb_publishable_ul9dGypnoGkwgddxEBVBYQ_Tlao-Lej`
  (safe in client code — RLS is the real boundary)

Managed via the Supabase MCP server (`apply_migration`, `execute_sql`,
`get_advisors`).

**The schema is now versioned in the repo** at `supabase/migrations/` — all 17
applied migrations, reconstructed verbatim from
`supabase_migrations.schema_migrations` so filenames and order match the remote
history exactly. See `supabase/README.md` for how to apply them and for the
three non-negotiable rules when writing new ones (`security invoker`, quoting
`public."current_role"()`, materialising `current_org_id()`).

The Supabase CLI and `pg_dump` are **not installed** on this machine, which is
why the migrations were reconstructed from the database's own record rather than
dumped.

### Schema (all RLS-protected, org-scoped)

```
organizations   (+ legal_name, industry, website, address, support_email)
profiles        (id → auth.users, org_id, role: 'rep' | 'manager')
store_groups    (e.g. "Choppies Retail Group")
stores          (+ store_group_id, lat/lng, geofence_radius_m)
routes          (rep_id, store_id, scheduled_date, scheduled_start_at/end_at)
visits          (client_generated_id, GPS check-in/out, checkin_distance_from_store_m)
form_templates → form_fields
form_submissions → form_responses
photos          (storage_path, lat/lng, taken_at)
workday_sessions (started_at/ended_at, distance_meters, client_generated_id)
location_pings  (lat/lng, source: interval|checkin|checkout|workday_start|workday_end)
```

Storage bucket **`visit-photos`**, path convention `org_id/rep_id/visit_id/<uuid>.jpg`
(the storage RLS policy checks that prefix).

Helper functions `public.current_org_id()` and `public.current_role()` are
`SECURITY DEFINER` and used by every RLS policy. **Every RLS policy wraps
auth calls in `(select ...)`** — this is deliberate, for per-query rather than
per-row evaluation. Don't "simplify" it back.

`client_generated_id` on rep-writable tables is the **offline idempotency key** —
sync upserts key off it, not the server `id`.

### Test accounts (all password `GoldFortune2026!`)
- `manager@goldfortune.dev` — manager
- `rep@goldfortune.dev` — rep (has seeded routes)
- 10 more reps: `allen.david@`, `phillips.nancy@`, `folds.benjamin@`,
  `cora.craig@`, `roberts.anthony@`, `coll.jason@`, `smith.devon@`,
  `henry.christopher@`, `williams.ashley@`, `alexander.william@`
  (all `@goldfortune.dev`)

Created via direct SQL into `auth.users` + `auth.identities` because Supabase's
signup email flow is rate-limited (no SMTP configured).

---

## 3. Web dashboard (`web/`)

Next.js 16 + Tailwind v4 + shadcn/ui. Run with `npm run dev` (port 3000).

**Live against Supabase:** Dashboard (KPIs), Stores (+ groups, edit, Google
Maps links, list/map), Schedule (timeline + New Visit), Forms (+ builder with
field reordering), Visits drill-down, Company Profile (details + team).

**Still mock/stub:**
- **Reports** — placeholder charts. Real form submissions now exist to drive it.
- **Time & Mileage** — stub page. `workday_sessions` + `location_pings` data now exists.
- **Plan & Billing** tab — illustrative; no payment provider integrated.
- **Invite team member** — shows an explanatory note; needs a server-side
  service-role flow (Edge Function), deliberately not embedded in client code.

### Gotchas learned the hard way
- **Next.js 16** renamed the middleware convention: the file is `proxy.ts` and
  exports `proxy`, not `middleware`.
- **shadcn/ui now sits on base-ui**: use the `render={<X/>}` prop, *not* `asChild`.
- **A shadcn `Select` inside a `Dialog` swallows clicks** (the dialog's
  outside-click dismissal eats them). Use the custom
  `components/ui/native-select.tsx` inside dialogs instead. This bit us twice.
- The scaffold generated a self-referential `--font-sans: var(--font-sans)`,
  which silently fell back to serif. Fixed to `var(--font-geist-sans)`.

---

## 4. Mobile app (`mobile/`)

Flutter 3.44.8 / Dart 3.12. Package `com.goldfortune.gf_merch_rep`.
Riverpod 3, go_router, drift, geolocator, image_picker, connectivity_plus, uuid.

**Working and verified on the Android emulator:**
- Login against Supabase; managers are bounced to a "use the web dashboard" screen
- Today's route (RLS-scoped to that rep only)
- Store detail with **GPS check-in/out**. Geofence verified precisely: 0.2 m
  when placed on the store's coords, 440 km at the wrong store. Distance is
  **recorded and warned about, not blocked** — reps legitimately stand outside
  large stores and GPS drifts.
- **Workday start/end** with live hours + mileage on the main screen
- **GPS pings every 20 min** while a workday is open, plus at check-in/out
- **Forms** — all six field types; **camera-only photos** (gallery deliberately
  disabled to prevent passing off stored images), GPS-stamped at capture
- **Short-visit warning** — confirm dialog if checking out under 5 minutes

**Offline sync — VERIFIED end-to-end on the emulator (26 Jul 2026).**
Drift outbox (`lib/data/local/app_database.dart`, `lib/data/sync/sync_engine.dart`),
all rep writes routed through it, route caching for offline reads, `SyncBanner`.

Full airplane-mode run: start workday → check in → form with camera photo →
check out → cold restart still offline → reconnect. Result: **7 queued
operations drained, every row landed exactly once, zero duplicates.**
- Offline timestamps are preserved (check-in 19:42, check-out 19:49 recorded
  as such despite syncing at 19:52) — the server clock does not overwrite them.
- Geofence distance 0.15 m; photo reached storage byte-identical (31,321 B) at
  `org/rep/visit/<uuid>.jpg`; all 3 pings resolved to their workday session.
- `client_generated_id` upsert proved itself: re-checking in against an
  existing visit row updated it rather than inserting a second visit.

Verifying it uncovered four real bugs, all fixed on branch
`offline-sync-verification` — see §4.1.

### 4.1 Bugs found by actually running the offline path

Every one of these passed `flutter analyze` and would only ever appear on a
device with no signal. Worth remembering: the analyzer proves nothing about
offline behaviour.

1. **The router made every navigation a network call.** `redirect` in
   `app.dart` fetched the profile role from Supabase on *every* navigation.
   Offline the host lookup threw `GoException` and navigation was aborted —
   the rep was frozen on the route list and could not open a store at all.
   Fixed: the role is cached in a Drift key/value table and read cache-first,
   refreshed in the background. An unknown role now falls through to the rep
   UI rather than trapping the user (RLS, not routing, is the access boundary).

2. **An offline workday vanished on app restart.** `fetchActiveSession` was
   server-only, so after a restart the app showed "Workday not started" while
   a `workday_start` sat in the outbox. The rep would tap Start again and
   queue a **second session**. Fixed: the active session is cached locally,
   cleared on end, and trusted whenever its start is still queued.

3. **An offline check-in was invisible, which duplicated visits.** After
   check-in the UI re-read the *cached* route (still `not_started`) because
   `applyLocalVisitChange` was written but never called. Tapping Check in
   again minted a **new** `client_generated_id` — a genuine duplicate visit,
   defeating the whole idempotency scheme. Fixed: check-in/check-out now write
   through to the route cache.

4. **Forms were unusable offline.** `fetchActiveTemplates` had no cache or
   fallback, and `fetchSubmittedTemplateIds` ignored the outbox, so a form
   submitted offline never showed as submitted. Fixed: templates are cached on
   every successful fetch (and warmed from the route screen, so a rep who
   loses signal on the road still has their forms), and queued submissions
   count as submitted.

### Unscheduled visits (added 26 Jul 2026, verified offline end-to-end)

A rep can start a visit at any active org store via the "Unscheduled visit"
FAB on the route list. Decisions locked in with the user:
- **`visits.route_id` stays NULL** — `routes` means strictly "what was
  planned", so adherence reporting stays honest.
- **Any active store in the org** is allowed; the recorded GPS distance tells
  the manager whether the rep was really there. Deactivated stores are
  excluded from the picker.
- The store list is cached (key `stores` in the KV table) and prefetched from
  the route screen, so the picker works offline.
- Ad-hoc visits live in `cached_routes` with `ad_hoc=1`, keyed by the visit's
  `client_generated_id` (`RouteVisit.cacheKey`); schedule refreshes never
  delete them. They sort after scheduled stops and wear an "Unscheduled" tag;
  the web Visits page shows an amber UNSCHEDULED badge (`route === null`).
- Workday-first and forms-before-checkout gates apply to them unchanged.

Verified: picked a store offline, checked in (0.0 m), form + photo offline,
cold restart offline, reconnect → landed exactly once with `route_id` NULL,
checkout preserved the offline timestamps (43m 35s duration).

**Known limitation:** the rep's own view of a *synced* unscheduled visit
depends on the local ad-hoc cache row — the routes query cannot return a
route-less visit. If app data is wiped mid-visit, the rep can no longer see or
check out of it (the server row stays open). Fine for now; a proper fix would
query today's route-less visits by `rep_id` on fetch.

### More bugs found while verifying (all fixed)

5. **Double-tap check-out queued twice.** `_busy` was only set after awaiting
   the short-visit confirm dialog, so two quick taps both enqueued. Harmless
   server-side (idempotent UPDATE) but wrong; `_busy` now latches first.
6. **`getCurrentPosition` could hang forever.** geolocator's `timeLimit`
   does not fire when the platform never emits a fix (observed >90 s on the
   emulator); the check-in/out button stayed latched indefinitely. Now
   wrapped in a hard `.timeout(20s)` falling back to `getLastKnownPosition()`,
   then a clear "couldn't get a GPS fix" error.
7. **Null profile silently disabled every rep action.** `profileProvider` had
   no offline cache; after an offline app restart, check-in/check-out/form
   submit all began `if (profile == null) return;` — live-looking buttons
   that did nothing. The profile is now cached per user (`profile:<uid>`),
   and the guards show a "connect once" snackbar instead of failing silently.

### Workday bookends + gamification (added 27 Jul 2026, verified on-device)

The start and end of the workday are now full-screen moments, not just a
button toggle:

- **Day plan** (`/day-plan`, shown after Start workday): greeting with the
  rep's first name, numbered list of today's stops with time slots (done ones
  ticked and struck through), and the month-so-far progress card. Renders
  offline (route cache + cached monthly figure). Empty-schedule variant
  points at "Unscheduled visit".
- **End-of-day guard**: ending with unfinished stores shows "Finish your
  route first?" naming the store (or count), with "Keep working" as the
  emphasised default. Never-checked-in unscheduled visits don't nag — they're
  abandoned intentions, not commitments.
- **Workday summary** (`/workday-summary`): time worked, distance, "N of M"
  scheduled stores, "+N" unscheduled extras. If the whole schedule was
  covered: trophy + "Well done!". Otherwise a neutral "Workday ended".
- **Monthly reward metric** (`RouteRepository.fetchMonthlyCompletion`):
  scheduled routes month-to-date with a checked-out visit / total scheduled.
  ≥90% (`kMonthlyRewardTarget`) shows gold "on track for this month's
  reward" messaging on both screens; below shows progress toward it.
  Unscheduled visits deliberately count neither for nor against. **What the
  reward actually is remains a product decision** — the app only promises
  "the monthly reward". Cached per month for offline display.

**Distance/mileage is now actually verified** (it never had been — it only
accrues on the 20-min interval ping). Tested with the interval temporarily at
2 min: two pings 4.96 km apart → banner showed 5.0 km → summary showed
5.0 km → server row recorded `distance_meters` 4965. Interval is back at
20 min. Note the accrual model: chord distance between successive interval
pings only — check-in/out pings don't contribute legs, and `_lastPingPosition`
resets on app restart, so real driving is somewhat undercounted by design.

**Also found while testing:** postgrest-dart's `.order()` defaults to
*descending*. Today's route (server path), the store picker, and form
templates had all been rendering reverse-ordered whenever data came from the
network — the offline cache paths sort ascending, which masked it. All three
now pass `ascending: true` explicitly.

### Business rules enforced in the rep app
- **A workday must be open before checking in.** Check in is disabled with an
  explanatory note, plus a backstop in `_checkIn`.
- **All active forms must be submitted before checking out.** Check out is
  disabled until then, naming the outstanding form. Queued (unsynced)
  submissions satisfy this, so the rule works offline. If templates cannot be
  loaded at all the gate stays open — a rep must never be stranded at a store
  by a form the app can't show them.

### Riverpod 3 gotchas
- **Providers auto-dispose by default** — call `ref.keepAlive()` for anything
  that must outlive a screen. This silently wiped the active workday when
  navigating to a store.
- `StateProvider` moved to `package:flutter_riverpod/legacy.dart`
- `AsyncValue.valueOrNull` is now just `.value`

---

## 5. Local environment

Installed and working:
- Flutter `3.44.8` at `/opt/homebrew/bin/flutter`
- Android SDK at `~/Library/Android/sdk` (platforms 34 + 36, build-tools,
  emulator, cmdline-tools, licences accepted)
- Emulator AVD named **`gf_pixel`**
- Node 22 / npm

**Java:** the Temurin cask install failed (needs an interactive sudo password).
Use Android Studio's bundled JDK instead:
```
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

**Xcode is NOT installed** — only Command Line Tools. **iOS has never been
built or tested.** Installing Xcode is a manual ~10 GB App Store download that
only the user can do.

### Useful commands
```bash
export PATH="/opt/homebrew/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# boot emulator
$ANDROID_SDK_ROOT/emulator/emulator -avd gf_pixel -no-snapshot-load -no-boot-anim &

# run app
cd "/Users/conradbrink/Downloads/GF Merchandising/mobile" && flutter run -d emulator-5554

# fake GPS (lng first!)
adb emu geo fix -78.6382 35.7796      # Costco Raleigh
adb emu geo fix -77.3064 38.8462      # 7-Eleven Fairfax

# toggle network for offline testing
adb shell svc wifi disable && adb shell svc data disable
adb shell svc wifi enable  && adb shell svc data enable

# screenshot
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png /tmp/s.png
```

---

## 6. Open items, roughly by priority

1. ~~Verify offline sync end-to-end~~ **Done** — see §4 and §4.1.
   Remaining smaller offline items:
   - ~~Rep's name disappears offline~~ Fixed — profile is cached now (§ bugs 7).
   - `SyncBanner` only appears on the route screen, not on store/form screens,
     so a rep filling a form has no offline indicator.
   - The store screen's form gate shows "submit the form" for ~15 s after an
     offline restart while `submittedTemplateIds` waits for the network to
     fail before falling back to the outbox. Cosmetic flicker; querying the
     outbox first would fix it.
   - The sync engine's "already landed" guard for partially-replayed form
     submissions was never exercised — the queue drained cleanly first time.
     Worth a deliberate mid-drain kill to test.
2. **Wire Time & Mileage page** — data exists, page is a stub.
3. **Wire Reports page** — real form submissions now exist.
4. **Background GPS decision.** The 20-min timer only runs while the app is
   foregrounded or recently backgrounded. True background tracking needs an
   Android foreground service with a persistent notification plus
   `ACCESS_BACKGROUND_LOCATION` (which Google reviews specially). This is a
   product/UX decision, not just code.
5. **iOS** — completely untested; needs Xcode.
6. **Remote backup** — git is initialised (branch `main`, initial commit
   `5167116`) but is **local only**. No GitHub remote, and `gh` is not
   installed on this machine. A disk failure still loses everything.
7. See `docs/pre-launch-checklist.md` for security items (leaked-password
   protection is Pro-plan-only and the org is on Free; seeded dev accounts
   share a known password and must be rotated).

---

## 7. Working style that worked well

- Verify on the real emulator/browser with screenshots — several real bugs
  (stretched logo, wiped workday state, "Starting…" on first load, dialog
  click-swallowing) were only visible by actually running it.
- After schema changes, run Supabase `get_advisors` for both `security` and
  `performance` and fix WARN-level findings.
- Run `flutter analyze` / `npx tsc --noEmit` after each chunk.
