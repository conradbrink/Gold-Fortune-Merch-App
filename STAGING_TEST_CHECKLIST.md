# Staging test checklist

Run before any release. Tick what you tested; write "n/a" where a change
plainly cannot touch it — but be honest, because the ones that get skipped are
the ones that break.

⚠️ **Staging does not exist yet.** Until it does, run this against a
development build pointed at a **non-production** database. Never run the
destructive parts against production.

🔴 = highest risk. If time is short, do these.

---

## Access and permissions

- [ ] 🔴 Manager can sign in on the website
- [ ] 🔴 Rep can sign in on the phone app
- [ ] Rep signing in on the *website* lands on the notice page, not the dashboard
- [ ] 🔴 Rep cannot reach a manager-only page by typing the URL directly
- [ ] 🔴 **One company cannot see another's data** — see the automated check below
- [ ] Password reset: request, receive, set a new one, sign in with it
- [ ] Sign out, then confirm the back button does not restore the session
- [ ] Session expiry behaves — an old session is refused, not silently broken

## Rep's day — the core loop

- [ ] 🔴 Assigned stores load for the signed-in rep
- [ ] Only that rep's stores appear, not the whole estate
- [ ] Territory filtering shows the right stores
- [ ] Scheduled visits appear for today
- [ ] 🔴 Start workday works
- [ ] 🔴 **Cannot start a second workday the same day** after ending one
- [ ] Unscheduled store check-in
- [ ] Unscheduled sales visit (a lead, not an existing store)

## Location

- [ ] 🔴 Location permission is requested, and refusing is handled gracefully
- [ ] 🔴 GPS check-in records a position
- [ ] Check-out records a position
- [ ] 🔴 A check-in far from the store is flagged, not silently accepted
- [ ] A check-in cannot be recorded with no position at all
- [ ] Distance from store is recorded and cannot be edited by the rep

## Capture

- [ ] Stock level capture
- [ ] Product facings capture
- [ ] Shelf price capture
- [ ] 🔴 Photo capture, then upload
- [ ] Order capture
- [ ] Form submission completes and appears on the dashboard
- [ ] Visit completion moves the store to Done

## Offline — the part most likely to break

- [ ] 🔴 **Turn mobile data and wifi off.** The app still opens and shows today's stores
- [ ] 🔴 Complete a full visit offline: check in, photo, form, check out
- [ ] The rep is told their work is saved but not yet sent
- [ ] Force-close and reopen while still offline — the work is still there
- [ ] 🔴 **Turn connectivity back on.** Everything syncs
- [ ] 🔴 **No duplicates** — one visit on the server, not two
- [ ] 🔴 Photos taken offline upload after reconnecting
- [ ] Sync survives being interrupted halfway (turn data off mid-sync, back on)
- [ ] The pending count returns to zero

## Website

- [ ] Dashboard figures match what was captured
- [ ] Reports load
- [ ] Stores, territories, schedule, forms, promotions all load
- [ ] Adding a rep works, and that rep can sign in
- [ ] 🔴 Works at phone width (375px), tablet and desktop
- [ ] Error page appears rather than a stack trace when something fails
- [ ] `/download` loads **without** being signed in

## Upgrade

- [ ] 🔴 Install the new APK **over** the previous version — not a fresh install
- [ ] Still signed in afterwards
- [ ] 🔴 Any unsynced work survived the upgrade
- [ ] The update banner appears when a newer version is published
- [ ] "Later" dismisses it, and it does not reappear for that same version
- [ ] A forced update blocks the app when below the minimum version

---

## Automate these first

The highest-risk items are the tenancy ones, because a failure is invisible
until it is catastrophic — and they are already automated:

**`supabase/tests/security_regression.sql`** — 26 checks. Paste into the SQL
editor; it runs in a transaction that rolls back and must raise
"ALL SECURITY CHECKS PASSED". Covers cross-organisation access, a rep
promoting themselves, reading another rep's visits, tampering with GPS
evidence, and the audit log.

**Run it before every release**, and always after a change to policies,
triggers, grants or RPCs.

⚠️ If it raises anything other than PASSED or SECURITY REGRESSIONS, **the suite
is broken, not the database** — fix the suite before trusting a green run. It
silently stopped running once already when a schema change broke its fixtures.

Worth automating next, in rough order of value:

1. Offline capture → reconnect → no duplicates *(the most valuable and the
   hardest; today it is manual)*
2. Rep cannot reach manager pages *(an API test, cheap)*
3. Login for both roles *(a smoke test against staging)*
