-- Rollback of 20261026143700_activation_account_status: puts back
-- platform_company_activation() as 20261010470000 made it, without
-- account_status and period_end, with the same grants and comment.
-- The web code reads both columns, so roll the web back first.

drop function public.platform_company_activation(uuid[]);

create function public.platform_company_activation(p_org_ids uuid[] default null)
returns table (
  org_id                uuid,
  name                  text,
  created_at            timestamptz,
  timezone              text,
  setup_started         boolean,
  setup_finished_at     timestamptz,
  people                integer,
  team_on_at            timestamptz,
  first_client_at       timestamptz,
  first_workday_at      timestamptz,
  first_job_started_at  timestamptz,
  first_job_finished_at timestamptz,
  finished_days_14      integer,
  last_activity_at      timestamptz,
  last_sign_in_at       timestamptz,
  trial_ends_at         timestamptz,
  contact_name          text,
  contact_email         text,
  contact_phone         text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with p as (
    select pr.org_id,
           count(*) filter (where pr.is_active)                                                   as people,
           (array_agg(pr.created_at order by pr.created_at, pr.id) filter (where pr.is_active))[2] as team_on_at,
           (array_agg(pr.id order by (pr.role = 'rep'), pr.created_at, pr.id) filter (where pr.is_active))[1] as first_person
    from public.profiles pr
    where p_org_ids is null or pr.org_id = any(p_org_ids)
    group by pr.org_id
  ),
  s as (
    select st.org_id, min(st.created_at) as first_client_at
    from public.stores st
    where p_org_ids is null or st.org_id = any(p_org_ids)
    group by st.org_id
  ),
  w as (
    select ws.org_id, min(ws.started_at) as first_workday_at, max(ws.started_at) as last_workday_at
    from public.workday_sessions ws
    where p_org_ids is null or ws.org_id = any(p_org_ids)
    group by ws.org_id
  ),
  v as (
    select vi.org_id,
           min(vi.checkin_at)  as first_job_started_at,
           min(vi.checkout_at) as first_job_finished_at,
           max(vi.checkin_at)  as last_checkin_at,
           count(distinct (vi.checkout_at at time zone o2.timezone)::date)
             filter (where vi.checkout_at >= now() - interval '14 days') as finished_days_14
    from public.visits vi
    join public.organizations o2 on o2.id = vi.org_id
    where p_org_ids is null or vi.org_id = any(p_org_ids)
    group by vi.org_id
  ),
  u as (
    select pr.org_id, max(au.last_sign_in_at) as last_sign_in_at
    from public.profiles pr
    join auth.users au on au.id = pr.id
    where p_org_ids is null or pr.org_id = any(p_org_ids)
    group by pr.org_id
  )
  select o.id,
         o.name,
         o.created_at,
         o.timezone,
         (ca.wizard_step is not null or ca.wizard_finished_at is not null),
         ca.wizard_finished_at,
         coalesce(p.people, 0)::integer,
         p.team_on_at,
         s.first_client_at,
         w.first_workday_at,
         v.first_job_started_at,
         v.first_job_finished_at,
         coalesce(v.finished_days_14, 0)::integer,
         greatest(w.last_workday_at, v.last_checkin_at),
         u.last_sign_in_at,
         ca.trial_ends_at,
         fp.full_name,
         coalesce(fp.email, fu.email),
         fp.phone
  from public.organizations o
  left join public.company_account ca on ca.org_id = o.id
  left join p on p.org_id = o.id
  left join public.profiles fp on fp.id = p.first_person
  left join auth.users fu on fu.id = p.first_person
  left join s on s.org_id = o.id
  left join w on w.org_id = o.id
  left join v on v.org_id = o.id
  left join u on u.org_id = o.id
  where p_org_ids is null or o.id = any(p_org_ids)
  order by o.created_at;
$function$;

revoke all on function public.platform_company_activation(uuid[]) from public, anon, authenticated;
grant execute on function public.platform_company_activation(uuid[]) to service_role;

comment on function public.platform_company_activation(uuid[]) is
  'Control Centre: each company''s onboarding milestones (setup, team, first client or site, first workday, first job started and finished), activity, sign-in, free period and first administrator''s contact. Service role only.';
