-- `left join visits on v.route_id = ro.id` fans out when a route has more than
-- one linked visit, double-counting it in `planned`. One route in the current
-- data has two visits, which made the total read 121 against 120 actual routes.
--
-- EXISTS is both fan-out-proof and the correct semantic: a route was served if
-- ANY linked visit checked out. A rep who checked in twice still served it once.
create or replace function public.schedule_adherence(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  rep_id         uuid,
  rep_name       text,
  planned        bigint,
  completed      bigint,
  missed         bigint,
  adherence_rate numeric,
  missed_detail  jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, current_date as today
  ),
  r as materialized (
    select ro.id, ro.rep_id, ro.store_id, ro.scheduled_date,
           exists (
             select 1 from visits v
             where v.route_id = ro.id and v.status = 'checked_out'
           ) as done
    from routes ro
    cross join cfg
    where ro.org_id = cfg.org
      and ro.scheduled_date >= p_from::date
      and ro.scheduled_date <  p_to::date
      -- A route scheduled for tomorrow is not "missed" — it simply hasn't
      -- happened yet. Counting it would make every rep look negligent.
      and ro.scheduled_date <= cfg.today
  )
  select r.rep_id,
         p.full_name,
         count(*),
         count(*) filter (where r.done),
         count(*) filter (where not r.done),
         case when count(*) > 0
              then round((count(*) filter (where r.done))::numeric / count(*), 4)
         end,
         coalesce((
           select jsonb_agg(jsonb_build_object('store', st.name, 'date', r2.scheduled_date)
                            order by r2.scheduled_date desc)
           from (
             select r3.store_id, r3.scheduled_date
             from r r3
             where r3.rep_id is not distinct from r.rep_id and not r3.done
             order by r3.scheduled_date desc
             limit 10
           ) r2
           join stores st on st.id = r2.store_id
         ), '[]'::jsonb)
  from r
  left join profiles p on p.id = r.rep_id
  group by r.rep_id, p.full_name
  order by 6 asc nulls last;
$$;
