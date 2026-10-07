-- Modules and company settings: the catalogue, each company's switches and
-- values, and the helpers that read them. **Nothing is enforced here.** The
-- next migration (`enforce_modules`) adds the gates; this one only gives them
-- something to read, so the web and the phone can start reading config before
-- any door is locked.
--
-- Why: the platform is being opened to companies other than Gold Fortune.
-- Requirements (Field Teams Platform, draft v6, §5.1 and §6): "Every feature is
-- a module that can be switched on or off per company"; and "Settings currently
-- hard-coded in the Gold Fortune app (19:30 auto-close, 20-minute GPS interval,
-- 5-minute short visit, check-in distance) move into company settings".
--
-- Gold Fortune is seeded so nothing changes for it: every built module on, and
-- every setting stored explicitly at the value the code uses today. The GPS
-- interval is **5** minutes. The brief says 20, but the phone has pinged every
-- 5 minutes since #55, and that is what Gold Fortune runs.
--
-- Who writes what:
--   * modules, module_dependencies, setting_definitions: the catalogue. Global,
--     readable by any signed-in user, written only by migrations.
--   * company_modules: switched by the platform operator (service role, via
--     `/platform`, audit-logged). A company can read its own switches but not
--     change them, because modules are tied to the plan.
--   * company_settings: edited by a company's own people holding
--     `company_settings`, through RLS, validated by a trigger.
--
-- Rollback: supabase/rollback/<this version>_modules_and_settings.down.sql.

----------------------------------------------------------------- the catalogue

create table public.modules (
  code          text primary key check (code ~ '^[a-z][a-z_]*$'),
  name          text not null,
  description   text not null,
  -- core: always on, never stored per company. included: part of every plan.
  -- addon: paid extra. edition: what makes an industry edition (Distribution).
  plan_type     text not null check (plan_type in ('core','included','addon','edition')),
  -- False for modules in the requirements that are not built yet; the operator
  -- view lists them but they cannot be switched on.
  is_built      boolean not null default true,
  -- Prices live in the database, never in code. Null until billing (Stage 6):
  -- the HR and warehouse prices in the requirements are tiered.
  monthly_price numeric(10,2) check (monthly_price is null or monthly_price >= 0),
  sort_order    integer not null default 0
);

create table public.module_dependencies (
  module_code   text not null references public.modules(code) on delete cascade,
  requires_code text not null references public.modules(code) on delete cascade,
  primary key (module_code, requires_code),
  check (module_code <> requires_code)
);

insert into public.modules (code, name, description, plan_type, is_built, sort_order) values
  ('core', 'Core tracking',
   'Workday start and end, GPS trail, live map, check-in and check-out, distance flags, short-visit flags, kilometres and hours; sites, schedule and visits; photos; files.',
   'core', true, 10),
  ('recurring_jobs', 'Recurring jobs',
   'Visit frequencies and call cycles that generate the schedule ahead.',
   'included', true, 20),
  ('checklists_forms', 'Checklists and forms',
   'Form builder, forms filled in on a visit, required forms before check-out.',
   'included', true, 30),
  ('reports', 'Reports and exports',
   'Scorecards, adherence, coverage, trends, performance reports and exports.',
   'included', true, 40),
  ('proof_of_work', 'Proof-of-work report',
   'Job PDF, client sign-off, send to client.',
   'included', false, 50),
  ('owner_notifications', 'Owner notifications',
   'Daily summary and exception alerts.',
   'included', false, 60),
  ('distribution', 'Distribution',
   'Products, orders, quotes, promotions, leads and sales visits, Perfect Store and out-of-stock reporting.',
   'edition', true, 70),
  ('warehouse', 'Warehouse and deliveries',
   'Stock, receiving, picking, stock counts, transfers, dispatch and proof of delivery.',
   'addon', true, 80),
  ('hr', 'HR',
   'Employee records, leave, documents, performance reviews and disciplinary cases.',
   'addon', true, 90),
  ('assets', 'Assets and equipment',
   'Equipment register with QR stickers, check-out and check-in, service dates.',
   'addon', false, 100),
  ('vehicle_logbook', 'Vehicle logbook',
   'Vehicle per employee per day, odometer photos, business kilometres, travel logbook export.',
   'addon', false, 110),
  ('invoicing', 'Quotes and invoices',
   'Quote to invoice from a completed job, tax invoice fields, sequential numbering.',
   'addon', false, 120),
  ('accounting_sync', 'Accounting sync',
   'Clients, invoices and payments synced with accounting software.',
   'addon', false, 130);

insert into public.module_dependencies (module_code, requires_code) values
  ('warehouse', 'distribution');

create table public.setting_definitions (
  key            text primary key check (key ~ '^[a-z][a-z_]*$'),
  label          text not null,
  description    text not null,
  value_type     text not null check (value_type in ('integer','boolean','time','text')),
  default_value  jsonb not null,
  min_value      numeric,
  max_value      numeric,
  -- For text settings: a regular expression the value must match.
  pattern        text,
  sort_order     integer not null default 0
);

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('gps_ping_interval_minutes', 'GPS interval (minutes)',
   'How often a phone records its position while the workday is open.',
   'integer', '5', 1, 60, null, 10),
  ('short_visit_minutes', 'Short visit (minutes)',
   'A check-out sooner than this after check-in asks the employee to confirm. 0 turns the check off.',
   'integer', '5', 0, 120, null, 20),
  ('auto_end_enabled', 'End forgotten workdays automatically',
   'Close a workday nobody ended at the time below. Turn off for night shifts.',
   'boolean', 'true', null, null, null, 30),
  ('auto_end_time', 'Automatic end time',
   'Local time at which a forgotten workday is closed.',
   'time', '"19:30"', null, null, null, 40),
  ('checkin_radius_m', 'Check-in radius (metres)',
   'Default distance from a site within which a check-in counts as on site. Each site can override it.',
   'integer', '100', 10, 5000, null, 50),
  ('off_site_distance_m', 'Off-site distance (metres)',
   'A check-in further than this from the site is flagged off site.',
   'integer', '500', 50, 50000, null, 60),
  ('invalid_gps_distance_m', 'Implausible GPS distance (metres)',
   'A check-in further than this is treated as a bad GPS fix rather than a real position.',
   'integer', '5000', 100, 500000, null, 70),
  ('currency_code', 'Currency',
   'ISO 4217 code used for money on screen, in reports and exports.',
   'text', '"BWP"', null, null, '^[A-Z]{3}$', 80);

-------------------------------------------------------------- per company

create table public.company_modules (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  module_code text not null references public.modules(code),
  enabled     boolean not null default true,
  enabled_at  timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (org_id, module_code),
  check (module_code <> 'core')
);

create table public.company_settings (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  key        text not null references public.setting_definitions(key),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (org_id, key)
);

-- A switch must name a built module, and must respect dependencies in both
-- directions: warehouse cannot be on without distribution, and distribution
-- cannot go off while warehouse is on.
create or replace function public.company_modules_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_missing text; v_dependent text;
begin
  if new.enabled then
    if not (select is_built from public.modules where code = new.module_code) then
      raise exception '% is not available yet', new.module_code using errcode = '22023';
    end if;
    select string_agg(d.requires_code, ', ') into v_missing
      from public.module_dependencies d
     where d.module_code = new.module_code
       and not exists (select 1 from public.company_modules cm
                        where cm.org_id = new.org_id and cm.module_code = d.requires_code
                          and cm.enabled);
    if v_missing is not null then
      raise exception '% needs % switched on first', new.module_code, v_missing
        using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or not old.enabled then
      new.enabled_at := now();
    end if;
  else
    select string_agg(d.module_code, ', ') into v_dependent
      from public.module_dependencies d
      join public.company_modules cm
        on cm.org_id = new.org_id and cm.module_code = d.module_code and cm.enabled
     where d.requires_code = new.module_code;
    if v_dependent is not null then
      raise exception '% is needed by %; switch that off first', new.module_code, v_dependent
        using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

create trigger company_modules_guard
  before insert or update on public.company_modules
  for each row execute function public.company_modules_guard();

revoke all on function public.company_modules_guard() from public, anon, authenticated;

-- Type and range from the definition. A bad value is refused with the
-- setting's label, which is what the settings page shows.
create or replace function public.company_settings_validate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d public.setting_definitions; v_num numeric;
begin
  select * into d from public.setting_definitions where key = new.key;
  if d.value_type = 'integer' then
    if jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::numeric % 1 <> 0 then
      raise exception '% must be a whole number', d.label using errcode = '22023';
    end if;
    v_num := (new.value #>> '{}')::numeric;
    if (d.min_value is not null and v_num < d.min_value)
       or (d.max_value is not null and v_num > d.max_value) then
      raise exception '% must be between % and %', d.label, d.min_value, d.max_value
        using errcode = '22023';
    end if;
  elsif d.value_type = 'boolean' then
    if jsonb_typeof(new.value) <> 'boolean' then
      raise exception '% must be on or off', d.label using errcode = '22023';
    end if;
  elsif d.value_type = 'time' then
    if jsonb_typeof(new.value) <> 'string' or (new.value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception '% must be a time like 19:30', d.label using errcode = '22023';
    end if;
  elsif d.value_type = 'text' then
    if jsonb_typeof(new.value) <> 'string'
       or (d.pattern is not null and (new.value #>> '{}') !~ d.pattern) then
      raise exception '% is not valid', d.label using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

create trigger company_settings_validate
  before insert or update on public.company_settings
  for each row execute function public.company_settings_validate();

revoke all on function public.company_settings_validate() from public, anon, authenticated;

------------------------------------------------------------------------ RLS

alter table public.modules enable row level security;
alter table public.module_dependencies enable row level security;
alter table public.setting_definitions enable row level security;
alter table public.company_modules enable row level security;
alter table public.company_settings enable row level security;

create policy modules_select on public.modules
  for select to authenticated using (true);
create policy module_dependencies_select on public.module_dependencies
  for select to authenticated using (true);
create policy setting_definitions_select on public.setting_definitions
  for select to authenticated using (true);
revoke insert, update, delete on public.modules, public.module_dependencies,
  public.setting_definitions from anon, authenticated;

-- Switches: read your own company's, never write them.
create policy company_modules_select on public.company_modules
  for select to authenticated
  using (org_id = (select public.current_org_id()));
revoke insert, update, delete on public.company_modules from anon, authenticated;

-- Settings: read your own company's; write them with `company_settings`.
create policy company_settings_select on public.company_settings
  for select to authenticated
  using (org_id = (select public.current_org_id()));
create policy company_settings_insert on public.company_settings
  for insert to authenticated
  with check (org_id = (select public.current_org_id())
              and (select public.has_permission('company_settings')));
create policy company_settings_update on public.company_settings
  for update to authenticated
  using (org_id = (select public.current_org_id())
         and (select public.has_permission('company_settings')))
  with check (org_id = (select public.current_org_id()));
revoke delete on public.company_settings from anon, authenticated;
revoke all on public.company_settings, public.company_modules from anon;

-------------------------------------------------------------------- helpers

-- Whether the caller's company has a module. `core` is always on. A caller
-- that is not a signed-in user (the service role, a database session) is
-- never gated: the crons and the operator act across companies on purpose.
-- `anon` is a signed-out user and has no company, so it gets false.
create or replace function public.module_enabled(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(auth.role(), 'service_role') = 'service_role'
      or exists (select 1 from public.modules m
                  where m.code = p_code and m.plan_type = 'core')
      or exists (select 1 from public.company_modules cm
                  where cm.org_id = public.current_org_id()
                    and cm.module_code = p_code
                    and cm.enabled)
$function$;

revoke all on function public.module_enabled(text) from public, anon;
grant execute on function public.module_enabled(text) to authenticated, service_role;

comment on function public.module_enabled is
  'Whether the caller''s company has the module switched on. core is always on; the service role and database sessions are never gated.';

-- The refusing form, for the top of a function. 42501 is what PostgREST maps
-- to 403; the message is the one the web and phone show.
create or replace function public.require_module(p_code text)
returns boolean
language plpgsql
stable
security invoker
set search_path to 'public'
as $function$
begin
  if not public.module_enabled(p_code) then
    raise exception '% is not enabled for your company''s plan',
      coalesce((select name from public.modules where code = p_code), p_code)
      using errcode = '42501', hint = 'module:' || p_code;
  end if;
  return true;
end;
$function$;

revoke all on function public.require_module(text) from public, anon;
grant execute on function public.require_module(text) to authenticated, service_role;

-- A setting for the caller's company, falling back to the definition.
create or replace function public.company_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select cs.value from public.company_settings cs
      where cs.org_id = public.current_org_id() and cs.key = p_key),
    (select d.default_value from public.setting_definitions d where d.key = p_key))
$function$;

revoke all on function public.company_setting(text) from public, anon;
grant execute on function public.company_setting(text) to authenticated, service_role;

-- A setting for a named company: for the service role (crons), and for SQL
-- that already knows the row's company. A signed-in caller asking about
-- another company gets null, the same rule as org_timezone.
create or replace function public.org_setting(p_org uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when public.caller_may_read_org(p_org) then
    coalesce(
      (select cs.value from public.company_settings cs
        where cs.org_id = p_org and cs.key = p_key),
      (select d.default_value from public.setting_definitions d where d.key = p_key))
  end
$function$;

revoke all on function public.org_setting(uuid, text) from public, anon;
grant execute on function public.org_setting(uuid, text) to authenticated, service_role;

-- Everything a client needs in one call: which modules are on, every setting
-- with its effective value, and the two company facts already kept on
-- `organizations`. Null for a caller with no company.
create or replace function public.my_company_config()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (select public.current_org_id() as org)
  select case when me.org is null then null else jsonb_build_object(
    'org_id', me.org,
    'modules', (
      select jsonb_object_agg(m.code,
               m.plan_type = 'core'
               or coalesce((select cm.enabled from public.company_modules cm
                             where cm.org_id = me.org and cm.module_code = m.code), false))
        from public.modules m),
    'settings', (
      select jsonb_object_agg(d.key,
               coalesce((select cs.value from public.company_settings cs
                          where cs.org_id = me.org and cs.key = d.key), d.default_value))
        from public.setting_definitions d),
    'timezone', (select o.timezone from public.organizations o where o.id = me.org),
    'vat_rate', (select o.vat_rate from public.organizations o where o.id = me.org)
  ) end
  from me
$function$;

revoke all on function public.my_company_config() from public, anon;
grant execute on function public.my_company_config() to authenticated, service_role;

comment on function public.my_company_config is
  'The caller''s company configuration: modules on/off, effective settings, timezone, VAT rate. One call for the web and the phone.';

-------------------------------------------------------------------- seeding

-- Every existing company (only Gold Fortune today) keeps everything it has:
-- every built module on, and every setting written down at today's value, so
-- a later change to a default does not move it.
insert into public.company_modules (org_id, module_code, enabled)
select o.id, m.code, true
  from public.organizations o
  cross join public.modules m
 where m.plan_type <> 'core' and m.is_built
 order by m.sort_order          -- distribution before warehouse (dependency)
on conflict do nothing;

insert into public.company_settings (org_id, key, value)
select o.id, d.key, d.default_value
  from public.organizations o
  cross join public.setting_definitions d
on conflict do nothing;

-- A new company gets the core and the included modules. Industry templates
-- (Stage 4) will replace this with the template's own selection.
create or replace function public.provision_company_modules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.company_modules (org_id, module_code, enabled)
  select new.id, m.code, true
    from public.modules m
   where m.plan_type = 'included' and m.is_built
  on conflict do nothing;
  return new;
end;
$function$;

revoke all on function public.provision_company_modules() from public, anon, authenticated;

create trigger organizations_provision_modules
  after insert on public.organizations
  for each row execute function public.provision_company_modules();
