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
`get_advisors`). There is **no local `supabase/` migrations folder** — schema
was applied directly through MCP.

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
   - The rep's name disappears from the route header while offline
     (`profileProvider` has no cache, unlike role/routes/templates). Cosmetic.
   - `SyncBanner` only appears on the route screen, not on store/form screens,
     so a rep filling a form has no offline indicator.
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
