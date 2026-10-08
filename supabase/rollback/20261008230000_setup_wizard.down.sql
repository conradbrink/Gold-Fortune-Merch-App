-- Rollback of 20261008230000_setup_wizard: the set-up wizard.
--
-- Drops the three functions, the VAT-rate row and the two company_account
-- columns (their grants go with them), and points "Invite your staff" back at
-- /representatives. Trial companies lose where they were in the wizard; nothing
-- else they entered lives here.

delete from public.module_assignments
 where kind = 'function' and name in ('my_setup', 'save_setup_step', 'my_team_status');

drop function if exists public.my_team_status();
drop function if exists public.save_setup_step(text, boolean);
drop function if exists public.my_setup();

update public.onboarding_steps set href = '/representatives'
 where code = 'invite_staff' and href = '/settings/users';

delete from public.platform_settings where key = 'country_defaults';

alter table public.company_account
  drop column if exists wizard_finished_at,
  drop column if exists wizard_step;
