-- A timezone per organisation, instead of Botswana compiled into seven places.
--
-- `'Africa/Gaborone'` was hard-coded in `rep_day_times_per_day`,
-- `dashboard_operations`, `hr_attendance_report` and the four HR dashboard
-- functions. Each carried a comment saying "one place to change if the customer
-- ever operates outside CAT", and by this morning there were seven of them —
-- which is how that comment always ends.
--
-- It matters more than it looks. The zone is not a display preference: it
-- decides which calendar day an event belongs to. A workday that starts at
-- 07:00 in Lagos is 06:00 UTC, and reading it in CAT puts it on the right day
-- by luck. A rep finishing at 23:30 local, read in the wrong zone, moves to the
-- next day — and then the attendance report shows a day with an end and no
-- start, followed by one with a start and no end. Both are wrong, neither looks
-- wrong, and the fix would be applied to whichever of the seven copies somebody
-- found first.
--
-- The default stays `Africa/Gaborone`, so nothing about today's data or
-- today's numbers moves. A second tenant sets theirs on the company profile.

alter table public.organizations
  add column if not exists timezone text not null default 'Africa/Gaborone';

comment on column public.organizations.timezone is
  'IANA zone name. Decides which calendar day an event falls on for attendance, the working-day card and every dashboard. Validated on write — an invalid name makes `at time zone` raise, which would take those screens down rather than merely being wrong.';

/**
 * Refuse a zone Postgres does not know.
 *
 * A check constraint cannot do this: `pg_timezone_names` is a view over the
 * running system's zone database and is not immutable, so Postgres will not
 * accept it in a constraint. A trigger can, and it has to happen somewhere —
 * `at time zone 'Gabarone'` (one letter out) raises `invalid_parameter_value`,
 * and every screen that asks what day it is would go down together.
 */
create or replace function public.validate_org_timezone()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception '% is not a timezone this database knows. Use an IANA name such as Africa/Gaborone or Africa/Johannesburg.',
      new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_validate_timezone on public.organizations;
create trigger organizations_validate_timezone
  before insert or update of timezone on public.organizations
  for each row execute function public.validate_org_timezone();

/**
 * The organisation's zone, or UTC.
 *
 * UTC is the fallback rather than Gaborone, deliberately. Gaborone would put
 * the old hard-coded assumption back — in one place instead of seven, but back
 * — and would quietly give a tenant whose org row could not be read a two-hour
 * shift that looks like data. The only way to reach the fallback is an org that
 * does not exist, and every caller already guards against a null organisation
 * before it gets here.
 */
create or replace function public.org_timezone(p_org uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select o.timezone from public.organizations o where o.id = p_org), 'UTC')
$$;

revoke all on function public.org_timezone(uuid) from public, anon;
revoke all on function public.validate_org_timezone() from public, anon, authenticated;
grant execute on function public.org_timezone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Replace the seven copies
-- ---------------------------------------------------------------------------
--
-- One substitution covers all three shapes the literal appears in:
--
--     'Africa/Gaborone'::text as tz            → org_timezone(…)::text as tz
--     (now() at time zone 'Africa/Gaborone')   → (now() at time zone org_timezone(…))
--
-- Snapshotted before the loop and asserted after it, for the same reasons as
-- the permission conversion: a cursor over `pg_proc` while rewriting it will
-- convert some functions twice and others not at all, and a partial conversion
-- means the day boundary moves on four screens and not the other three.

do $$
declare
  f      record;
  v_old  constant text := '''Africa/Gaborone''';
  v_new  constant text := 'public.org_timezone(public.current_org_id())';
  v_done integer := 0;
  v_left integer;
begin
  create temporary table _tz_fns on commit drop as
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and position(v_old in pg_get_functiondef(p.oid)) > 0;

  for f in select * from _tz_fns loop
    -- `create or replace` keeps the grants, several of which were handed out
    -- individually to `authenticated`.
    execute replace(f.def, v_old, v_new);
    v_done := v_done + 1;
  end loop;

  select count(*) into v_left
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and position(v_old in pg_get_functiondef(p.oid)) > 0;

  if v_left > 0 then
    raise exception 'rewrote % functions but % still hard-code the zone', v_done, v_left;
  end if;
  raise notice 'rewrote % functions to read the organisation timezone', v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may change it
-- ---------------------------------------------------------------------------
--
-- The company profile is where the zone is set, so its policy moves to the
-- permission that guards that page. `data_enforced` flips with it — the badge
-- on the admin screen has to stop saying "Menu only" the moment it stops being
-- true, or the one flag telling an administrator which tick boxes are real
-- becomes the thing that misleads them.

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update using (
    id = (select public.current_org_id())
    and (select public.has_permission('company_settings'))
  );

update public.app_permissions
   set data_enforced = true,
       description = 'The organisation profile, VAT rate and timezone.'
 where code = 'company_settings';
