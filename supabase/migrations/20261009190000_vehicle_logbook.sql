-- Vehicle logbook, the web part (Stage 8 Part 6). The odometer readings and
-- photos come later, with phone app 1.2.0; until then the office assigns.
--
-- Why: the sales site promises "Replaces a paper logbook for kilometres".
-- Tickd already measures each person's kilometres per day along the roads
-- (`workday_sessions.road_distance_meters`, filled nightly). What a logbook
-- adds is the vehicle: which car somebody drove that day, and whether the
-- trip was business or private.
--
--   logbook_vehicles   the company's cars and bakkies: a name, a registration,
--                      notes, in use or not. NOT `vehicles`: that table is the
--                      warehouse's delivery fleet (Stage 2 of the warehouse,
--                      `20260802161416`), gated by `warehouse`, readable only
--                      by managers and clerks, tied to stock locations, and
--                      read by the phone's delivery screens. Sharing it would
--                      mean changing its gate and its policies under a phone
--                      already in the field; a company with both add-ons keeps
--                      two short lists instead.
--   vehicle_days       who drove which vehicle on which company day, business
--                      or private, with the opening and closing odometer when
--                      known. One row per vehicle, person and day.
--   vehicle_logbook()  the logbook itself: per vehicle-day, the person's km by
--                      road that day, the odometer, first in and last out.
--
-- Who may: everyone signed in reads the company's vehicles (the phone will
-- offer them to pick from). Writing vehicles and assigning them needs
-- `insights`, the permission of the Hours report and Tracking pages, which
-- already show these kilometres per person per day: the person who reads the
-- km is the one who keeps the logbook. `company_settings` was the other
-- candidate and is the wrong person: it is the administrator who edits the
-- company profile, not the manager who checks the week's travel. A person
-- reads their own vehicle days; the rest are management information.
--
-- The module: `vehicle_logbook` was catalogued unbuilt (`20261007112542`).
-- `company_modules_guard` refuses to switch on an unbuilt module, so it is
-- marked built here, or no company could ever have it. That switches it on
-- for nobody: existing companies (Gold Fortune included) have no row for it,
-- and only the operator, or a new company whose trade's template names it
-- (garden, plumbing, installation, delivery), gets it.
--
-- The phone app reads none of these tables.
--
-- Rollback: supabase/rollback/20261009190000_vehicle_logbook.down.sql.

----------------------------------------------------------------- the module

update public.modules set is_built = true where code = 'vehicle_logbook';

------------------------------------------------------------------- vehicles

create table public.logbook_vehicles (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  registration text not null check (length(btrim(registration)) between 1 and 20),
  notes        text check (notes is null or length(notes) <= 1000),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- For vehicle_days' foreign key: a day's vehicle is always its company's.
  unique (id, org_id)
);
comment on table public.logbook_vehicles is
  'The company''s vehicles for the travel logbook. Not the warehouse''s delivery fleet (vehicles).';

-- "nd 123 gp" and "ND 123 GP" are one car.
create unique index logbook_vehicles_org_registration_key
  on public.logbook_vehicles (org_id, upper(btrim(registration)));

create trigger logbook_vehicles_set_updated_at
  before update on public.logbook_vehicles
  for each row execute function public.set_updated_at();

alter table public.logbook_vehicles enable row level security;
create policy logbook_vehicles_select on public.logbook_vehicles for select
  using (org_id = (select public.current_org_id()));
create policy logbook_vehicles_insert on public.logbook_vehicles for insert
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('insights')));
create policy logbook_vehicles_update on public.logbook_vehicles for update
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('insights')))
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('insights')));
create policy module_gate on public.logbook_vehicles as restrictive for all
  using ((select public.module_enabled('vehicle_logbook')))
  with check ((select public.module_enabled('vehicle_logbook')));
-- No delete: a vehicle that was driven is in the logbook. It goes out of use.
revoke all on public.logbook_vehicles from anon, authenticated;
grant select on public.logbook_vehicles to authenticated;
grant insert (org_id, name, registration, notes, active) on public.logbook_vehicles to authenticated;
grant update (name, registration, notes, active) on public.logbook_vehicles to authenticated;

---------------------------------------------------------------- vehicle days

create table public.vehicle_days (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  vehicle_id     uuid not null,
  -- As workday_sessions.rep_id: a person removed takes their days with them.
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  -- The company's day, as every report counts days.
  day            date not null,
  purpose        text not null default 'business' check (purpose in ('business', 'private')),
  odometer_start integer check (odometer_start is null or odometer_start between 0 and 9999999),
  odometer_end   integer check (odometer_end is null or odometer_end between 0 and 9999999),
  notes          text check (notes is null or length(notes) <= 500),
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  foreign key (vehicle_id, org_id) references public.logbook_vehicles (id, org_id) on delete restrict,
  unique (vehicle_id, profile_id, day),
  constraint vehicle_days_odometer_order
    check (odometer_start is null or odometer_end is null or odometer_end >= odometer_start)
);
comment on table public.vehicle_days is
  'Which vehicle a person drove on a company day, business or private, with the odometer when known.';
create index vehicle_days_org_day_idx on public.vehicle_days (org_id, day);
create index vehicle_days_profile_day_idx on public.vehicle_days (profile_id, day);

alter table public.vehicle_days enable row level security;
create policy vehicle_days_select on public.vehicle_days for select
  using ((org_id = (select public.current_org_id()))
         and (profile_id = (select auth.uid()) or (select public.has_permission('insights'))));
create policy vehicle_days_insert on public.vehicle_days for insert
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('insights'))
              and exists (select 1 from public.profiles p
                           where p.id = vehicle_days.profile_id and p.org_id = (select public.current_org_id())));
create policy vehicle_days_update on public.vehicle_days for update
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('insights')))
  with check ((org_id = (select public.current_org_id())) and (select public.has_permission('insights'))
              and exists (select 1 from public.profiles p
                           where p.id = vehicle_days.profile_id and p.org_id = (select public.current_org_id())));
create policy vehicle_days_delete on public.vehicle_days for delete
  using ((org_id = (select public.current_org_id())) and (select public.has_permission('insights')));
create policy module_gate on public.vehicle_days as restrictive for all
  using ((select public.module_enabled('vehicle_logbook')))
  with check ((select public.module_enabled('vehicle_logbook')));
-- Who wrote a row is the database's to record.
revoke all on public.vehicle_days from anon, authenticated;
grant select, delete on public.vehicle_days to authenticated;
grant insert (org_id, vehicle_id, profile_id, day, purpose, odometer_start, odometer_end, notes)
  on public.vehicle_days to authenticated;
grant update (vehicle_id, profile_id, day, purpose, odometer_start, odometer_end, notes)
  on public.vehicle_days to authenticated;

-- The billing gate's three policies, where the gate exists (production), as
-- for every table a company writes.
do $migration$
declare
  t text;
begin
  if to_regprocedure('public.company_writable()') is null then
    return;
  end if;
  foreach t in array array['logbook_vehicles', 'vehicle_days'] loop
    execute format('create policy billing_gate_insert on public.%I as restrictive for insert to authenticated '
                   'with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_update on public.%I as restrictive for update to authenticated '
                   'using ((select public.company_writable())) with check ((select public.company_writable()))', t);
    execute format('create policy billing_gate_delete on public.%I as restrictive for delete to authenticated '
                   'using ((select public.company_writable()))', t);
  end loop;
end;
$migration$;

------------------------------------------------------------------ the logbook

-- One row per vehicle-day whose company day starts in [p_from, p_to). The km
-- are the driver's road distance for the workdays they started that day; null
-- until every one of them is measured (an open workday, or one the nightly
-- job has not reached), so a logbook never shows part of a day as the day.
-- Kilometres belong to a person, not a car: two vehicles for one person on
-- one day show that person's km on both.
create function public.vehicle_logbook(p_from timestamptz, p_to timestamptz, p_vehicle_id uuid default null)
returns table (vehicle_day_id uuid, vehicle_id uuid, vehicle_name text, registration text, day date,
               driver_id uuid, driver_name text, purpose text, km numeric,
               odometer_start integer, odometer_end integer,
               first_in timestamptz, last_out timestamptz, notes text)
language plpgsql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
begin
  perform public.require_module('vehicle_logbook');
  perform public.require_permission('insights');
  v_org := public.current_org_id();
  v_tz := public.org_timezone(v_org);
  return query
  select d.id,
         d.vehicle_id,
         v.name,
         v.registration,
         d.day,
         d.profile_id,
         p.full_name,
         d.purpose,
         w.km,
         d.odometer_start,
         d.odometer_end,
         w.first_in,
         w.last_out,
         d.notes
    from public.vehicle_days d
    join public.logbook_vehicles v on v.id = d.vehicle_id
    left join public.profiles p on p.id = d.profile_id
    left join lateral (
      select min(ws.started_at) as first_in,
             case when bool_or(ws.ended_at is null) then null else max(ws.ended_at) end as last_out,
             case when bool_or(ws.road_distance_meters is null) then null
                  else round(sum(ws.road_distance_meters) / 1000.0, 1) end as km
        from public.workday_sessions ws
       where ws.org_id = v_org and ws.rep_id = d.profile_id
         and ws.started_at >= (d.day::timestamp at time zone v_tz)
         and ws.started_at < ((d.day + 1)::timestamp at time zone v_tz)
    ) w on true
   where d.org_id = v_org
     and (d.day::timestamp at time zone v_tz) >= p_from
     and (d.day::timestamp at time zone v_tz) < p_to
     and (p_vehicle_id is null or d.vehicle_id = p_vehicle_id)
   order by d.day, v.name, p.full_name, d.id;
end;
$function$;

revoke all on function public.vehicle_logbook(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.vehicle_logbook(timestamptz, timestamptz, uuid) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'logbook_vehicles', 'vehicle_logbook'),
  ('table', 'vehicle_days', 'vehicle_logbook'),
  ('function', 'vehicle_logbook', 'vehicle_logbook');
