-- Founding 10: applications from the sales site, and the spots left.
--
-- Why: the owner (10 Oct 2026) wants the first 10 businesses to apply by form
-- instead of starting the free trial on their own, so each one can be phoned,
-- helped to set up and followed up. The sales site posts the form to the app
-- (/api/founding), which saves it here and emails the owner. The site's
-- "X of 10 spots left" reads the same table.
--
--   founding_applications  one row per application. Written and read by the
--                          service role only (the server, after its own checks
--                          and rate limits); nobody signed in or anonymous can
--                          touch it. The owner works through it by hand in
--                          `status`: new -> contacted -> accepted | declined.
--                          'waitlist' is what an application becomes when it
--                          arrives after every spot is taken.
--   founding_spots()       { total, taken, left }. total is the platform
--                          setting founding_spots; taken counts the accepted
--                          applications, so a spot is only gone once the owner
--                          has said yes.
--
-- Rollback: supabase/rollback/20261010200000_founding_applications.down.sql.

create table public.founding_applications (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  -- International format, digits only, e.g. 27821234567.
  whatsapp          text not null check (whatsapp ~ '^[0-9]{9,15}$'),
  business_name     text not null check (char_length(btrim(business_name)) between 1 and 120),
  -- An industry template code (cleaning, security, ...); "generic" is something else.
  trade             text not null check (trade ~ '^[a-z][a-z_]*$'),
  team_size         text not null check (team_size in ('1-2', '3-5', '6-15', '16+')),
  headache          text check (headache is null or char_length(headache) <= 1000),
  -- Where the visitor came from (?src=whatsapp on the link), for knowing which
  -- channel brings the best applications.
  source            text check (source is null or source ~ '^[a-z0-9_-]{1,40}$'),
  status            text not null default 'new'
                      check (status in ('new', 'contacted', 'accepted', 'declined', 'waitlist')),
  status_changed_at timestamptz,
  -- When the owner's email went out; null if the email could not be sent (the
  -- application is still saved).
  notified_at       timestamptz
);

create index founding_applications_status_idx on public.founding_applications (status, created_at);

alter table public.founding_applications enable row level security;
-- No policies: the service role (the server, after its own checks) only.
revoke all on public.founding_applications from anon, authenticated;

insert into public.platform_settings (key, value, description) values
  ('founding_spots', '10', 'How many Founding spots the sales site offers. The spots left is this minus the accepted applications.');

create or replace function public.founding_spots()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with s as (
    select coalesce((select (value #>> '{}')::int from public.platform_settings where key = 'founding_spots'), 0) as total,
           (select count(*)::int from public.founding_applications where status = 'accepted') as taken
  )
  select jsonb_build_object('total', total, 'taken', taken, 'left', greatest(total - taken, 0)) from s;
$function$;

revoke all on function public.founding_spots() from public, anon, authenticated;
grant execute on function public.founding_spots() to service_role;

-- Both are for every company's operator, not one module (README rule 4).
insert into public.module_assignments (kind, name, module_code) values
  ('table', 'founding_applications', 'core'),
  ('function', 'founding_spots', 'core');
