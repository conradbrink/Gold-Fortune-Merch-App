-- Rollback for trial_and_onboarding: the trial, the getting-started list and
-- the service's settings go. Companies that signed up keep everything
-- create_company gave them; only their trial date (and the list's state) goes
-- with company_account.

delete from public.module_assignments
 where (kind = 'function' and name in ('my_onboarding', 'dismiss_onboarding',
                                       'consume_anonymous_rate_limit', 'start_trial_company'))
    or (kind = 'table' and name in ('platform_settings', 'company_account', 'onboarding_steps'));

drop function public.start_trial_company(jsonb, text[], uuid);
drop function public.consume_anonymous_rate_limit(text, text, integer, integer);
drop function public.dismiss_onboarding();
drop function public.my_onboarding();

drop table public.onboarding_steps;
drop table public.company_account;
drop table public.platform_settings;
