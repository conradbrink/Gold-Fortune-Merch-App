-- Let a manager delete a lead outright.
--
-- ------------------------------------------------------------- what changes
--
-- `20260730072204_create_leads` closed with a deliberate note:
--
--   "No delete policy, deliberately. A prospect that was called on is a record
--    of work done, and 'Lost' is a stage rather than a reason to erase the
--    visit."
--
-- That reasoning still holds for a *called-on prospect*, and nothing here
-- weakens it: 'Lost' remains the way to close a real call that went nowhere.
-- What it did not cover is the case the owner actually has — a card that should
-- never have existed at all (a mistyped company, a duplicate, a test row) —
-- where the only honest disposition is that no such call happened. Moving that
-- to 'Lost' does not record work done, it records a call on a shop nobody
-- visited, and it sits on the board for ever.
--
-- Manager-only, and deliberately not extended to the rep who owns the row:
-- `leads_update` lets a rep finish their own call, which is their job; deciding
-- that a call is to be struck from the record is not.
--
-- --------------------------------------------------------------- the hazard
--
-- ⚠️ **The phone can resurrect a deleted lead, and worse.** `sync_engine.dart`
-- replays a sales call by upserting on `client_generated_id`, so a handset
-- still holding an unsent `salesVisitStart` will simply recreate the row it was
-- deleted from under. The completion path is nastier still: it updates by
-- `client_generated_id` and *throws* when no row matches, so deleting a lead
-- whose completion has not synced stalls that outbox entry until it hits
-- `kMaxAttempts` and gives up — the same dead-queue failure that left
-- SO-000007/8/9 stranded on two handsets.
--
-- Neither is reachable for a lead the server already holds as `completed`: both
-- outbox entries must have succeeded to get it there, and a successful entry is
-- removed from the queue. So the danger is confined to `in_progress` rows, and
-- the web UI says so on exactly those before it will delete one. That warning is
-- the mitigation — this is not enforced in SQL, because a genuinely abandoned
-- call (rep uninstalled the app, phone lost) is precisely an `in_progress` row
-- that has to be removable, and a check constraint here would block the one
-- case that most needs it.
--
-- No cascade to reason about: nothing references `public.leads(id)`.

create policy leads_delete on public.leads
  for delete using (
    org_id = (select public.current_org_id())
    and (select public.current_role()) = 'manager'
  );
