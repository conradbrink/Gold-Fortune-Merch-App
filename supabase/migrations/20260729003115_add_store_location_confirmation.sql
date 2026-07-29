-- A person has looked at this store's position and vouched for it.
--
-- Deliberately separate from `geocode_source`. That column says where a
-- coordinate came from; these two say that a human checked it, which is a
-- different fact with a different lifetime. A store can be geocoded twice and
-- confirmed once, or confirmed and then re-geocoded — and it is the second case
-- that makes this worth storing rather than inferring.
--
-- Learned expensively: a batch geocode re-ran over 31 stores whose coordinates
-- a person had already judged wrong and cleared, and silently re-applied the
-- same wrong answers, because nothing in the schema recorded that a human had
-- already ruled on them. `geocode_result` was preserved for exactly that
-- purpose and only a comment asked anyone to honour it. A comment is not a
-- constraint. This is the fact an automatic run must check before it writes.
--
-- The point of the whole feature is a new customer importing thousands of
-- stores: the ones that cannot be trusted surface for review, a person confirms
-- or repositions each, and nothing automatic touches them again afterwards.
alter table public.stores
  add column if not exists location_confirmed_at timestamptz,
  add column if not exists location_confirmed_by uuid
    references public.profiles(id) on delete set null;

comment on column public.stores.location_confirmed_at is
  'When a person confirmed this store is where the map says. Null means nobody has ruled on it. Survives re-geocoding on purpose — an automatic run must not clear or overwrite it.';
comment on column public.stores.location_confirmed_by is
  'Who confirmed it. Set null if that profile is removed, keeping the confirmation itself intact — that it was checked matters more than by whom.';

-- The review queue reads "unconfirmed, in this org" on every load, and for a
-- customer with thousands of stores that is the query that has to stay cheap.
-- Partial, because confirmed rows are exactly the ones it never asks for.
create index if not exists stores_org_unconfirmed_idx
  on public.stores (org_id)
  where location_confirmed_at is null;
