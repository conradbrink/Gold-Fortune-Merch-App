-- The operator's view of how far each company has got with Tickd.
--
-- Why: the owner's Control Centre (10 Oct 2026, spec sections 20, 29 and 36)
-- needs an onboarding pipeline and an activation funnel. Every milestone is a
-- fact Tickd already records, so this reads them rather than adding tracking,
-- and companies made before today are measured too.
--
--   platform_company_activation()  one row per company:
--     setup started / finished        company_account.wizard_step, wizard_finished_at
--     people, team_on_at              active profiles; when the second person was added
--     first_client_at                 the first client or site (stores.created_at)
--     first_workday_at                the first workday started
--     first_job_started_at            the first check-in
--     first_job_finished_at           the first check-out: "activated", the first
--                                     result the owner sees
--     finished_days_14                days (company's own time zone) with a job
--                                     finished in the last 14 days
--     last_activity_at, last_sign_in_at, trial_ends_at
--     contact_name/email/phone        the company's first person (its administrator),
--                                     so the operator can reach them in one click
--
-- One query over each table, grouped by company: one call for the whole page.
-- SECURITY DEFINER because it reads auth.users (last sign-in) and every company;
-- so it is callable by the service role only (the server, after its own
-- is_platform_admin() check). Nobody signed in or anonymous can execute it.
--
-- Rollback: supabase/rollback/20261010470000_platform_company_activation.down.sql.

create or replace function public.platform_company_activation()
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
           count(*) filter (where pr.is_active)                              as people,
           (array_agg(pr.created_at order by pr.created_at, pr.id))[2]       as team_on_at,
           (array_agg(pr.id order by pr.created_at, pr.id))[1]               as first_person
    from public.profiles pr
    group by pr.org_id
  ),
  s as (
    select st.org_id, min(st.created_at) as first_client_at
    from public.stores st
    group by st.org_id
  ),
  w as (
    select ws.org_id, min(ws.started_at) as first_workday_at, max(ws.started_at) as last_workday_at
    from public.workday_sessions ws
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
    group by vi.org_id
  ),
  u as (
    select pr.org_id, max(au.last_sign_in_at) as last_sign_in_at
    from public.profiles pr
    join auth.users au on au.id = pr.id
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
  order by o.created_at;
$function$;

revoke all on function public.platform_company_activation() from public, anon, authenticated;
grant execute on function public.platform_company_activation() to service_role;

comment on function public.platform_company_activation() is
  'Control Centre: each company''s onboarding milestones (setup, team, first client or site, first workday, first job started and finished), activity, sign-in, free period and first administrator''s contact. Service role only.';
