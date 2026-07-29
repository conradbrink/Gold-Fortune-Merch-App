-- An off switch for the expensive features, separate from the app's own health.
--
-- The rate limiter caps what any one user can spend. It does nothing about a
-- bill that is climbing for a reason nobody has diagnosed yet — a loop in a
-- client, a price change at a provider, or a key that has leaked and is being
-- used somewhere the referrer restriction does not cover.
--
-- The response to that should not be "take the product down". A rep in a shop
-- still needs to check in, and none of that costs anything. This lets the
-- paid features be switched off on their own, in seconds, without a deploy.
--
-- One row, global. Deliberately **not** per-organisation: this is an operator
-- control for whoever runs the service and pays the providers, not a customer
-- setting. A customer switching off their own geocoding is a product feature
-- and can be added separately if it is ever wanted.

create table if not exists public.service_flags (
  -- Enforced singleton: one row, always id = 1.
  id                bool primary key default true,
  geocoding_enabled boolean not null default true,
  insights_enabled  boolean not null default true,
  -- Shown to the user instead of a bare failure, so a switched-off feature
  -- reads as a decision rather than a bug.
  notice            text,
  updated_at        timestamptz not null default now(),
  constraint service_flags_singleton check (id)
);

insert into public.service_flags (id) values (true)
on conflict (id) do nothing;

alter table public.service_flags enable row level security;

-- Everyone signed in may read, so the UI can explain itself. Nobody may write
-- through the API — flipping a flag is a service-role act, done from the
-- Supabase SQL editor in a hurry, and a customer must not be able to turn a
-- feature back on that the operator has just switched off.
create policy service_flags_select on public.service_flags
  for select to authenticated using (true);

revoke insert, update, delete on public.service_flags from authenticated, anon;

comment on table public.service_flags is
  'Operator kill switches for features that cost money per use. Readable by any signed-in user so the UI can explain why something is off; writable only with the service role. To switch insights off: update public.service_flags set insights_enabled = false, notice = ''…'';';

/**
 * Reads a flag by name, defaulting to on.
 *
 * Defaulting to *on* is deliberate: if this table is somehow missing or
 * unreadable, the product keeps working. A kill switch that fails closed would
 * turn a small operational problem into an outage, which is the opposite of
 * what it is for.
 */
create or replace function public.service_flag(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case p_name
      when 'geocoding' then (select geocoding_enabled from service_flags where id)
      when 'insights'  then (select insights_enabled  from service_flags where id)
      else true
    end,
    true
  );
$$;

grant execute on function public.service_flag(text) to authenticated;

comment on function public.service_flag is
  'True when a paid feature is enabled. Defaults to true on any doubt — a kill switch that fails closed turns an operational problem into an outage.';
