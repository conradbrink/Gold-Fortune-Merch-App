-- Short visits, as a list the dashboard can flag (owner, 7 Oct: "add the short
-- visit flag to the dashboard").
--
-- The phone already warns a rep who checks out sooner than the company's
-- short_visit_minutes (5 by default) that "Short visits are flagged for your
-- manager" — and until now nothing on the dashboard did. short_visits(p_from,
-- p_to) is the one place the rule lives:
--   * the visit was checked out (an open visit has no length yet);
--   * checkout - checkin is shorter than company_setting short_visit_minutes.
-- Security invoker, like offsite_checkins: RLS on visits lets a manager see the
-- company and a rep only their own visits. Additive only: no existing function
-- changes, so the dashboard card counts this list itself.

create or replace function public.short_visits(p_from timestamptz, p_to timestamptz)
returns table (
  visit_id uuid,
  checkin_at timestamptz,
  checkout_at timestamptz,
  minutes double precision,
  rep_id uuid,
  rep_name text,
  store_id uuid,
  store_name text,
  short_visit_minutes integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with t as (
    select coalesce((public.company_setting('short_visit_minutes') #>> '{}')::integer, 5) as short_m
  )
  select v.id, v.checkin_at, v.checkout_at,
         extract(epoch from (v.checkout_at - v.checkin_at)) / 60.0,
         v.rep_id, p.full_name, s.id, s.name,
         t.short_m
  from public.visits v
  join public.stores s on s.id = v.store_id
  left join public.profiles p on p.id = v.rep_id
  cross join t
  where v.org_id = public.current_org_id()
    and v.checkin_at >= p_from and v.checkin_at < p_to
    and v.checkout_at is not null
    and v.checkout_at >= v.checkin_at
    and v.checkout_at - v.checkin_at < make_interval(mins => t.short_m)
  order by v.checkin_at desc
$$;

revoke all on function public.short_visits(timestamptz, timestamptz) from public, anon;
grant execute on function public.short_visits(timestamptz, timestamptz) to authenticated;

comment on function public.short_visits(timestamptz, timestamptz) is
  'Checked-out visits shorter than the company short_visit_minutes setting (5 by default). Security invoker.';

insert into public.module_assignments (kind, name, module_code)
values ('function', 'short_visits', 'core')
on conflict do nothing;
