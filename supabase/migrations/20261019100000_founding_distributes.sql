-- Founding 10 for distributors: "What do you distribute?" on the application.
--
-- Why: on 19 Oct 2026 the sales site became only for distributors with 3 to 20
-- reps, and the owner's new Founding package asks for the applicant's name,
-- WhatsApp, how many reps and what they distribute. One new column, optional,
-- so the applications already saved keep their answers and an older form (or
-- a half-done deploy) is not turned away. The API saves an application without
-- it if this migration is not applied yet (PGRST204), so either can go first.
--
-- Rollback: supabase/rollback/20261019100000_founding_distributes.down.sql.

alter table public.founding_applications
  add column distributes text
    check (distributes is null or char_length(btrim(distributes)) between 1 and 200);

comment on column public.founding_applications.distributes is
  'What the distributor distributes, in their words (asked from 19 Oct 2026). Null: not asked.';
