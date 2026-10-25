-- Rollback of 20261025100000_founding_call_form. An application sent with one
-- of /founding's new bands would break the old check, so those are moved to
-- the main page's band they fall in first ('16-30' and '31+' both to
-- '20-50+', which is close enough for a list the owner reads by hand).

update public.founding_applications set team_size = '1-4' where team_size in ('1-2', '3-5');
update public.founding_applications set team_size = '5-10' where team_size = '6-10';
update public.founding_applications set team_size = '20-50+' where team_size in ('16-30', '31+');

alter table public.founding_applications
  drop column contact_consent_at,
  drop column role,
  drop constraint founding_applications_team_size_check,
  add constraint founding_applications_team_size_check
    check (team_size in ('1-4', '5-10', '11-15', '20-50+', '11-25', '26-50', '50+'));
