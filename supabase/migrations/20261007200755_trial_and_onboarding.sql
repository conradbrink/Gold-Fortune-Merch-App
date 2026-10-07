-- Free trial and getting started.
--
-- Why: the owner wants a trial started on the sales site to land the person in
-- a working company of their trade, with a 14-day countdown from that moment
-- and a "getting started" list on the dashboard (7 Oct 2026, modelled on the
-- SalesPro Hub dashboard: "12 days left in your free trial", "Getting started
-- 2/7"). Stage 4's create_company already builds the company from its
-- industry; this adds what a self-service trial needs around it.
--
--   platform_settings      the service's own settings (trial length, contact
--                          details), read and written by the service role only.
--   company_account        per company: when its trial ends, and when its
--                          administrator put the getting-started list away.
--                          Readable by the company, writable by nobody through
--                          the API — a company cannot move its own trial date.
--                          A company without a row has no trial (Gold Fortune,
--                          and companies the operator creates) and has not put
--                          the list away.
--   onboarding_steps       the getting-started list, as data. A step that
--                          belongs to a module appears only for companies that
--                          have it, so each trade sees its own list. Titles name
--                          things through the company's words: {site.many|lower}.
--   my_onboarding()        the caller's list with each step done or not, worked
--                          out from what the company has actually done.
--   dismiss_onboarding()   puts the list away (company settings permission).
--   consume_anonymous_rate_limit()  the existing limiter for callers with no
--                          login (sign-up), keyed by a subject the server names.
--   start_trial_company()  create_company plus the trial, for the sign-up page.
--
-- Gold Fortune: gets a company_account row with no trial and the list already
-- put away, so nothing it sees changes.
--
-- Rollback: supabase/rollback/<this version>_trial_and_onboarding.down.sql.

------------------------------------------------------------ platform settings

create table public.platform_settings (
  key         text primary key check (key ~ '^[a-z][a-z_]*$'),
  value       jsonb not null,
  description text not null
);
alter table public.platform_settings enable row level security;
-- No policies: the service role (the server, after its own checks) only.
revoke all on public.platform_settings from anon, authenticated;

insert into public.platform_settings (key, value, description) values
  ('trial_days', '14', 'How many days a self-service trial lasts, counted from sign-up.'),
  ('sales_email', 'null', 'Where "Talk to us" sends an email, or null to hide it.'),
  ('sales_whatsapp', 'null', 'International number for "Talk to us" on WhatsApp (digits only), or null to hide it.'),
  ('pricing_url', 'null', 'The public price list "View plans" links to, or null to hide the link.');

------------------------------------------------------------ company account

create table public.company_account (
  org_id                  uuid primary key references public.organizations(id) on delete cascade,
  trial_ends_at           timestamptz,
  onboarding_dismissed_at timestamptz,
  onboarding_dismissed_by uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.company_account enable row level security;
create policy company_account_select on public.company_account
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke insert, update, delete, truncate on public.company_account from anon, authenticated;
revoke all on public.company_account from anon;

-- Every company that exists today: no trial, and the list already put away.
insert into public.company_account (org_id, onboarding_dismissed_at)
select id, now() from public.organizations;

------------------------------------------------------------ onboarding steps

create table public.onboarding_steps (
  code        text primary key check (code ~ '^[a-z][a-z_]*$'),
  title       text not null,
  description text not null,
  href        text not null check (href ~ '^/'),
  -- null: every company; otherwise only companies with this module on.
  module_code text references public.modules(code),
  sort_order  integer not null default 0
);
alter table public.onboarding_steps enable row level security;
create policy onboarding_steps_select on public.onboarding_steps for select to authenticated using (true);
revoke insert, update, delete, truncate on public.onboarding_steps from anon, authenticated;
revoke all on public.onboarding_steps from anon;

-- Each code has its check in my_onboarding(); a step without one is never done.
insert into public.onboarding_steps (code, title, description, href, module_code, sort_order) values
  ('company_profile', 'Complete your company profile',
   'Add your logo and address, so your reports and documents carry them.', '/settings/company', null, 10),
  ('invite_staff', 'Invite your {staff.many|lower}',
   'Give each of them a login for the phone app.', '/representatives', null, 20),
  ('add_sites', 'Add your {site.many|lower}',
   'Import a list, or add them one at a time.', '/stores', null, 30),
  ('plan_recurring', 'Plan your recurring {job.many|lower}',
   'Choose which {site.many|lower} are done on which days.', '/schedule', null, 40),
  ('first_checklist', 'Fill in a first checklist',
   'Check that the ready-made checklists fit the way you work.', '/forms', 'checklists_forms', 50),
  ('add_products', 'Add your products',
   'Your price list, so orders can be taken in the app.', '/products', 'distribution', 60),
  ('first_workday', 'Start a first workday on a phone',
   'Install the app and start a workday, then watch it on the map.', '/download', null, 70);

-- All core: the account and the list are for every company (README rule 4).
insert into public.module_assignments (kind, name, module_code) values
  ('table', 'platform_settings', 'core'),
  ('table', 'company_account', 'core'),
  ('table', 'onboarding_steps', 'core');

------------------------------------------------------------ my_onboarding

create or replace function public.my_onboarding()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org       uuid := public.current_org_id();
  v_dismissed timestamptz;
  v_steps     jsonb;
begin
  if v_org is null then
    raise exception 'Not signed in to a company.' using errcode = '42501';
  end if;

  select a.onboarding_dismissed_at into v_dismissed
    from public.company_account a where a.org_id = v_org;

  -- Only booleans leave this function, and only for the caller's own company.
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', s.code, 'title', s.title, 'description', s.description, 'href', s.href,
           'done', case s.code
             when 'company_profile' then exists (
               select 1 from public.organizations o
                where o.id = v_org and o.logo_path is not null and nullif(btrim(o.address), '') is not null)
             when 'invite_staff' then (select count(*) from public.profiles p where p.org_id = v_org) > 1
             when 'add_sites' then exists (select 1 from public.stores x where x.org_id = v_org)
             when 'plan_recurring' then exists (select 1 from public.store_assignments x where x.org_id = v_org)
             when 'first_checklist' then exists (select 1 from public.form_submissions x where x.org_id = v_org)
             when 'add_products' then exists (select 1 from public.products x where x.org_id = v_org)
             when 'first_workday' then exists (select 1 from public.workday_sessions x where x.org_id = v_org)
             else false
           end) order by s.sort_order), '[]'::jsonb)
    into v_steps
    from public.onboarding_steps s
   where s.module_code is null
      or exists (select 1 from public.company_modules cm
                  where cm.org_id = v_org and cm.module_code = s.module_code and cm.enabled);

  return jsonb_build_object('dismissed_at', v_dismissed, 'steps', v_steps);
end;
$function$;

revoke all on function public.my_onboarding() from public, anon;
grant execute on function public.my_onboarding() to authenticated;

------------------------------------------------------------ dismiss_onboarding

create or replace function public.dismiss_onboarding()
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
begin
  if v_org is null or not public.has_permission('company_settings') then
    raise exception 'Only someone who manages the company settings can put this away.' using errcode = '42501';
  end if;
  insert into public.company_account (org_id, onboarding_dismissed_at, onboarding_dismissed_by)
  values (v_org, now(), auth.uid())
  on conflict (org_id) do update
    set onboarding_dismissed_at = now(), onboarding_dismissed_by = auth.uid(), updated_at = now();
end;
$function$;

revoke all on function public.dismiss_onboarding() from public, anon;
grant execute on function public.dismiss_onboarding() to authenticated;

------------------------------------------------------- anonymous rate limit

-- consume_rate_limit keys on the caller's login, so it refuses a caller with
-- none. Sign-up has none: the server names the subject instead (the caller's
-- IP address, or the email being signed up), which is why only the service
-- role may call this.
create or replace function public.consume_anonymous_rate_limit(
  p_bucket text, p_subject text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_start timestamptz;
  v_count int;
begin
  if nullif(btrim(p_subject), '') is null then
    raise exception 'A rate limit needs a subject.' using errcode = '22023';
  end if;
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'Invalid rate limit parameters.' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (bucket, subject, window_start, count)
  values (p_bucket, 'anon:' || p_subject, v_start, 1)
  on conflict (bucket, subject, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'retry_after_seconds',
      ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::int);
end;
$function$;

revoke all on function public.consume_anonymous_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_anonymous_rate_limit(text, text, integer, integer) to service_role;

------------------------------------------------------- start_trial_company

-- The sign-up page's one call: the company exactly as the operator's
-- create_company would build it from the same industries, with its owner, and
-- a trial ending trial_days from now. One transaction: if any part is refused,
-- nothing is created. Self sign-ups write no platform_audit_log row (its actor
-- is a login that must stay deletable); a trial company is the one with a
-- trial_ends_at.
create or replace function public.start_trial_company(p_company jsonb, p_templates text[], p_owner uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_days int;
  v_org  uuid;
begin
  if p_owner is null then
    raise exception 'A trial needs its owner''s login.' using errcode = '22023';
  end if;
  select (value #>> '{}')::int into v_days from public.platform_settings where key = 'trial_days';
  if v_days is null or v_days < 1 then
    raise exception 'The trial length is not set (platform_settings.trial_days).' using errcode = '22023';
  end if;

  v_org := public.create_company(p_company, p_templates, '{}'::jsonb, p_owner, null);

  insert into public.company_account (org_id, trial_ends_at)
  values (v_org, now() + make_interval(days => v_days));
  return v_org;
end;
$function$;

revoke all on function public.start_trial_company(jsonb, text[], uuid) from public, anon, authenticated;
grant execute on function public.start_trial_company(jsonb, text[], uuid) to service_role;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'my_onboarding', 'core'),
  ('function', 'dismiss_onboarding', 'core'),
  ('function', 'consume_anonymous_rate_limit', 'core'),
  ('function', 'start_trial_company', 'core');
