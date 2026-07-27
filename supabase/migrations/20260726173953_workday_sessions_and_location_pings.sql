-- A rep's workday: started when they tap "Start workday", ended on "End
-- workday". distance_meters accumulates from consecutive GPS pings.
create table public.workday_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  distance_meters double precision not null default 0,
  duration_seconds int,
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workday_sessions_org_rep_idx on public.workday_sessions(org_id, rep_id);
create index workday_sessions_started_at_idx on public.workday_sessions(started_at desc);

create trigger workday_sessions_set_updated_at
  before update on public.workday_sessions
  for each row execute function public.set_updated_at();

-- Periodic location samples taken while a workday is active (~every 20 min),
-- plus the one-off sample captured at store check-in.
create table public.location_pings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  workday_session_id uuid references public.workday_sessions(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  recorded_at timestamptz not null default now(),
  source text not null default 'interval' check (source in ('interval','checkin','checkout','workday_start','workday_end')),
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index location_pings_org_rep_idx on public.location_pings(org_id, rep_id);
create index location_pings_session_idx on public.location_pings(workday_session_id);
create index location_pings_recorded_at_idx on public.location_pings(recorded_at desc);

alter table public.workday_sessions enable row level security;
alter table public.location_pings enable row level security;

-- Managers see the whole org; reps see and write only their own rows.
create policy workday_sessions_select on public.workday_sessions
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );

create policy workday_sessions_insert on public.workday_sessions
  for insert with check (
    org_id = (select public.current_org_id()) and rep_id = (select auth.uid())
  );

create policy workday_sessions_update on public.workday_sessions
  for update using (
    org_id = (select public.current_org_id()) and rep_id = (select auth.uid())
  );

create policy location_pings_select on public.location_pings
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.current_role()) = 'manager' or rep_id = (select auth.uid()))
  );

create policy location_pings_insert on public.location_pings
  for insert with check (
    org_id = (select public.current_org_id()) and rep_id = (select auth.uid())
  );
