-- What a hard delete would destroy.
--
-- Every rep-owned table cascades from profiles (visits, photos,
-- form_submissions, workday_sessions, routes, location_pings,
-- store_assignments), and profiles itself cascades from auth.users. So deleting
-- a rep erases their entire history and retroactively changes every report that
-- covered it. The UI must be able to state the cost before asking to confirm.
create or replace function public.rep_delete_impact(p_rep_id uuid)
returns table (
  rep_name    text,
  visits      bigint,
  submissions bigint,
  photos      bigint,
  workdays    bigint,
  routes      bigint,
  assignments bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  )
  select
    (select p.full_name from profiles p cross join cfg
      where p.id = p_rep_id and p.org_id = cfg.org),
    (select count(*) from visits v cross join cfg
      where v.rep_id = p_rep_id and v.org_id = cfg.org),
    (select count(*) from form_submissions f cross join cfg
      where f.rep_id = p_rep_id and f.org_id = cfg.org),
    (select count(*) from photos ph cross join cfg
      where ph.rep_id = p_rep_id and ph.org_id = cfg.org),
    (select count(*) from workday_sessions w cross join cfg
      where w.rep_id = p_rep_id and w.org_id = cfg.org),
    (select count(*) from routes r cross join cfg
      where r.rep_id = p_rep_id and r.org_id = cfg.org),
    (select count(*) from store_assignments sa cross join cfg
      where sa.rep_id = p_rep_id and sa.org_id = cfg.org);
$$;
