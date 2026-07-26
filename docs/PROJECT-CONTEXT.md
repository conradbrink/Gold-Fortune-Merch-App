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

**Written but NEVER RUN — this is the top priority:**
- **Offline sync.** Drift outbox (`lib/data/local/app_database.dart`,
  `lib/data/sync/sync_engine.dart`), all rep writes routed through it, route
  caching for offline reads, and a `SyncBanner`. It passes `flutter analyze`
  but the emulator shut down before it ever launched. **Assume it is unverified
  and possibly broken.**

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

1. **Verify offline sync end-to-end** (airplane mode: check in → submit form
   with photo → check out → reconnect → confirm each row lands exactly once,
   no duplicates). Never been run.
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
