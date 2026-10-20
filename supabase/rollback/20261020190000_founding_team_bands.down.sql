-- Rollback of 20261020190000_founding_team_bands. An application sent with a
-- new band ('11-15' or '20-50+') would break the old check, so those are
-- moved to the old band they fall in first.

update public.founding_applications set team_size = '11-25' where team_size = '11-15';
update public.founding_applications set team_size = '26-50' where team_size = '20-50+';

alter table public.founding_applications
  drop constraint founding_applications_team_size_check,
  add constraint founding_applications_team_size_check
    check (team_size in ('1-4', '5-10', '11-25', '26-50', '50+'));
