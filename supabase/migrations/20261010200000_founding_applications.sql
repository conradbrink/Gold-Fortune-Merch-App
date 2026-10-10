-- Founding 10: applications from the sales site (/founding), and the spots left.
--
-- Why: the owner (10 Oct 2026) is picking 10 businesses to run Tickd free for
-- 60 days, and wants each one to apply by form so every application can be
-- read and answered. The sales site posts the form to the app (/api/founding),
-- which saves it here and emails the owner at once. The app's operator area
-- (/platform/founding) lists them all in one place.
--
--   founding_applications  one row per application. Written and read by the
--                          service role only (the server, after its own checks
--                          and rate limits); nobody signed in or anonymous can
--                          touch it. The owner works through it by hand in
--                          `status`: new -> contacted -> accepted | declined.
--                          'waitlist' is what an application becomes when it
--                          arrives while no spot is left.
--   founding_spots_left()  the spots the sales site shows ("10 of 10 spots
--                          left"). It is ONE setting, platform_settings
--                          founding_spots_left, and only the owner changes it,
--                          when they pick someone. It does not count
--                          applications.
--
-- Rollback: supabase/rollback/20261010200000_founding_applications.down.sql.

create table public.founding_applications (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  business_name     text not null check (char_length(btrim(business_name)) between 1 and 120),
  -- International format, digits only, e.g. 27821234567.
  whatsapp          text not null check (whatsapp ~ '^[0-9]{9,15}$'),
  -- An industry template code (cleaning, security, ...); "generic" is something else.
  trade             text not null check (trade ~ '^[a-z][a-z_]*$'),
  team_size         text not null check (team_size in ('1-4', '5-10', '11-25', '26-50', '50+')),
  town              text not null check (char_length(btrim(town)) between 1 and 80),
  -- How they run jobs today.
  how_run           text not null check (how_run in ('whatsapp', 'paper', 'app', 'memory')),
  -- What costs them the most right now, in their words.
  biggest_cost      text not null check (char_length(btrim(biggest_cost)) between 1 and 1000),
  -- Will the whole team use Tickd every workday for 60 days?
  whole_team        boolean not null,
  -- Happy to do a 60-second phone video and a Google review at the end?
  video_review      boolean not null,
  -- Agreed that Tickd may use the business's name, logo, video and results in
  -- its marketing. The form cannot be sent without it.
  marketing_ok      boolean not null check (marketing_ok),
  -- Where the visitor came from (?src=facebook on the link).
  source            text check (source is null or source ~ '^[a-z0-9_-]{1,40}$'),
  status            text not null default 'new'
                      check (status in ('new', 'contacted', 'accepted', 'declined', 'waitlist')),
  status_changed_at timestamptz,
  -- When the owner's email went out; null if it could not be sent (the
  -- application is still saved).
  notified_at       timestamptz
);

create index founding_applications_status_idx on public.founding_applications (status, created_at);

alter table public.founding_applications enable row level security;
-- No policies: the service role (the server, after its own checks) only.
revoke all on public.founding_applications from anon, authenticated;

insert into public.platform_settings (key, value, description) values
  ('founding_spots_left', '10',
   'The Founding spots the sales site says are left ("10 of 10 spots left"). Only the owner changes it, when they pick someone. A whole number from 0 to 10.');

create or replace function public.founding_spots_left()
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select greatest(coalesce((select (value #>> '{}')::int from public.platform_settings where key = 'founding_spots_left'), 0), 0);
$function$;

revoke all on function public.founding_spots_left() from public, anon, authenticated;
grant execute on function public.founding_spots_left() to service_role;

-- Both are for every company's operator, not one module (README rule 4).
insert into public.module_assignments (kind, name, module_code) values
  ('table', 'founding_applications', 'core'),
  ('function', 'founding_spots_left', 'core');
