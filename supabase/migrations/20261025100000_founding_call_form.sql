-- /founding's form for the new sales process (owner, 25 Oct 2026): Conrad
-- calls each applicant within minutes, so the form asks who decides ("Your
-- role") and for the consent to be contacted, and has new "How many reps?"
-- bands (1 to 2, 3 to 5, 6 to 10, 11 to 15, 16 to 30, more than 30). The main
-- page keeps its form and bands, and applications already sent keep theirs, so
-- the check takes all of them. Both new columns are null for the main page's
-- form and for older applications.
--
-- Rollback: supabase/rollback/20261025100000_founding_call_form.down.sql.

alter table public.founding_applications
  drop constraint founding_applications_team_size_check,
  add constraint founding_applications_team_size_check
    check (team_size in (
      '1-2', '3-5', '6-10', '11-15', '16-30', '31+',
      '1-4', '5-10', '20-50+', '11-25', '26-50', '50+'
    )),
  add column role text check (role in ('owner', 'sales_manager', 'other')),
  add column contact_consent_at timestamptz;

comment on column public.founding_applications.role is
  'Their role, from /founding''s form (25 Oct 2026): owner, sales_manager or other. Null when not asked.';
comment on column public.founding_applications.contact_consent_at is
  'When they ticked "Tickd may contact me on WhatsApp, phone and email about my pilot". Null when not asked.';
