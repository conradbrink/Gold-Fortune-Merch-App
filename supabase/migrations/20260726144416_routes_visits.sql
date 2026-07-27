create table public.routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  scheduled_date date not null,
  sequence_order int,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index routes_org_rep_date_idx on public.routes(org_id, rep_id, scheduled_date);
create index routes_store_id_idx on public.routes(store_id);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started','checked_in','checked_out','missed')),
  checkin_at timestamptz,
  checkin_lat double precision,
  checkin_lng double precision,
  checkin_gps_accuracy_m double precision,
  checkin_distance_from_store_m double precision,
  checkout_at timestamptz,
  checkout_lat double precision,
  checkout_lng double precision,
  duration_seconds int,
  client_generated_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index visits_org_rep_idx on public.visits(org_id, rep_id);
create index visits_route_id_idx on public.visits(route_id);
create index visits_store_id_idx on public.visits(store_id);

create trigger visits_set_updated_at
  before update on public.visits
  for each row
  execute function public.set_updated_at();
