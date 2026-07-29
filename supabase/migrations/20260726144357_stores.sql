create table public.stores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  place_code text,
  territory text,
  lat double precision,
  lng double precision,
  geofence_radius_m int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index stores_org_id_idx on public.stores(org_id);
