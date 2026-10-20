-- The Founding form's "How many reps?" bands (owner, 20 Oct 2026): 1 to 4,
-- 5 to 10, 11 to 15, and 20 to 50+, in place of 11 to 25, 26 to 50 and 50+.
-- Applications already sent keep their bands, so the check takes both.
--
-- Rollback: supabase/rollback/20261020190000_founding_team_bands.down.sql.

alter table public.founding_applications
  drop constraint founding_applications_team_size_check,
  add constraint founding_applications_team_size_check
    check (team_size in ('1-4', '5-10', '11-15', '20-50+', '11-25', '26-50', '50+'));
