-- Stage 7 Part 2: the set-up wizard a new company walks through after sign-up.
--
-- * company_account remembers where the wizard is (wizard_step) and when it
--   was finished (wizard_finished_at). Every company that exists now is marked
--   finished, so Gold Fortune never sees it; a trial started from now on begins
--   unfinished.
-- * my_setup(): what the wizard needs for the caller's own company: whether it
--   shows, the step, the trade(s) and how the main one usually gets paid,
--   counts, the user places and the country's usual VAT rate.
-- * save_setup_step(): remembers the step; finishing is for good.
-- * my_team_status(): for the getting-started card, per person in the
--   caller's company: signed in yet, started a workday yet. Yes/no only.
-- * platform_settings 'country_defaults': the usual VAT rate per country,
--   offered when a new company says it charges VAT; the company can change its
--   own rate. Rates checked 8 Oct 2026; edit the row when a country changes.
-- * "Invite your staff" on the getting-started list opens Settings → Users
--   (/representatives no longer has an add button).
--
-- Reads company_account.status and .plan and calls billing_seats_used(), from
-- 20261008091250_billing (applied on production; its file arrives with #91).

alter table public.company_account
  add column wizard_step text,
  add column wizard_finished_at timestamptz;

-- The wizard is for new companies only.
update public.company_account set wizard_finished_at = now() where wizard_finished_at is null;

-- The company may read where it is, as it reads the rest of its row.
grant select (wizard_step, wizard_finished_at) on public.company_account to authenticated;

insert into public.platform_settings (key, value, description) values
  ('country_defaults',
   '{"ZA": {"vat_rate": 15}, "BW": {"vat_rate": 14}, "NA": {"vat_rate": 15}, "LS": {"vat_rate": 15},
     "SZ": {"vat_rate": 15}, "ZW": {"vat_rate": 15.5}, "ZM": {"vat_rate": 16}, "MZ": {"vat_rate": 16}}'::jsonb,
   'Per country (ISO code): the usual VAT rate, offered to a new company that charges VAT. Checked 8 Oct 2026.');

update public.onboarding_steps set href = '/settings/users'
 where code = 'invite_staff' and href = '/representatives';

create or replace function public.my_setup()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_org uuid := public.current_org_id();
  a public.company_account;
  v_industries text[];
  v_country text;
  v_limit int;
  v_used int;
begin
  if v_org is null or not public.has_permission('company_settings') then
    raise exception 'Only someone who manages the company settings can set it up.' using errcode = '42501';
  end if;
  select * into a from public.company_account where org_id = v_org;
  select coalesce(o.industries, '{}') into v_industries from public.organizations o where o.id = v_org;
  v_country := upper(coalesce(public.org_setting(v_org, 'country_code') #>> '{}', ''));
  -- The places rule of profiles_user_limit: the trial's, or the plan's seats.
  if a.org_id is not null and a.status is distinct from 'exempt' then
    if a.status = 'trial' or a.plan is null then
      v_limit := coalesce((public.platform_setting('trial_user_limit') #>> '{}')::int, 10);
      select count(*) into v_used from public.profiles p where p.org_id = v_org and p.is_active;
    else
      v_limit := (a.plan->>'seats')::int;
      v_used := public.billing_seats_used(v_org, a.plan);
    end if;
  end if;
  return jsonb_build_object(
    'show', coalesce(a.org_id is not null and a.status is distinct from 'exempt' and a.wizard_finished_at is null, false),
    'step', a.wizard_step,
    'finished_at', a.wizard_finished_at,
    'industries', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name) order by array_position(v_industries, t.code))
        from public.industry_templates t where t.code = any(v_industries)), '[]'::jsonb),
    -- How the main trade usually gets paid, to mark it among the choices.
    'trade_workflow', (select ts.value #>> '{}' from public.template_settings ts
                        where ts.template_code = v_industries[1] and ts.setting_key = 'money_workflow'),
    'counts', jsonb_build_object(
      'sites', (select count(*) from public.stores x where x.org_id = v_org),
      'people', (select count(*) from public.profiles x where x.org_id = v_org and x.is_active),
      'checklists', (select count(*) from public.form_templates x where x.org_id = v_org and x.active),
      'items', (select count(*) from public.service_items x where x.org_id = v_org and x.active),
      'priced_items', (select count(*) from public.service_items x where x.org_id = v_org and x.active and x.unit_price > 0),
      'products', (select count(*) from public.products x where x.org_id = v_org),
      'quotes', (select count(*) from public.quotes x where x.org_id = v_org),
      'contracts', (select count(*) from public.service_contracts x where x.org_id = v_org),
      'checkins', (select count(*) from public.visits x where x.org_id = v_org and x.checkin_at is not null)),
    'places', case when v_limit is null then null else jsonb_build_object('used', v_used, 'limit', v_limit) end,
    'country_code', nullif(v_country, ''),
    'vat_rate_default', public.platform_setting('country_defaults') -> v_country -> 'vat_rate');
end;
$function$;

revoke all on function public.my_setup() from public, anon;
grant execute on function public.my_setup() to authenticated;

create or replace function public.save_setup_step(p_step text, p_finished boolean default false)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_permission('company_settings') then
    raise exception 'Only someone who manages the company settings can set it up.' using errcode = '42501';
  end if;
  -- The steps are the web's; the database keeps a short code.
  if p_step is null or p_step !~ '^[a-z_]{1,30}$' then
    raise exception 'Unknown set-up step.' using errcode = '22023';
  end if;
  update public.company_account
     set wizard_step = p_step,
         wizard_finished_at = case when coalesce(p_finished, false)
                                   then coalesce(wizard_finished_at, now()) else wizard_finished_at end,
         updated_at = now()
   where org_id = v_org and status is distinct from 'exempt';
end;
$function$;

revoke all on function public.save_setup_step(text, boolean) from public, anon;
grant execute on function public.save_setup_step(text, boolean) to authenticated;

create or replace function public.my_team_status()
returns table (profile_id uuid, signed_in boolean, started_workday boolean)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_permission('company_settings') then
    raise exception 'Only someone who manages the company settings can see this.' using errcode = '42501';
  end if;
  -- Only yes/no leaves this function, and only for the caller's own company.
  return query
    select p.id,
           exists (select 1 from auth.users u where u.id = p.id and u.last_sign_in_at is not null),
           exists (select 1 from public.workday_sessions w where w.org_id = v_org and w.rep_id = p.id)
      from public.profiles p
     where p.org_id = v_org and p.is_active
     order by p.created_at, p.id;
end;
$function$;

revoke all on function public.my_team_status() from public, anon;
grant execute on function public.my_team_status() to authenticated;

-- All core: the wizard is for every company (README rule 4).
insert into public.module_assignments (kind, name, module_code) values
  ('function', 'my_setup', 'core'),
  ('function', 'save_setup_step', 'core'),
  ('function', 'my_team_status', 'core');
