-- What deleting a store would destroy.
--
-- `visits`, `routes` and `store_assignments` all cascade from stores, and
-- form_submissions and photos cascade from visits in turn. So deleting a store
-- silently erases every audit ever done there and retroactively changes every
-- report covering those dates — the same trap rep_delete_impact exists for
-- (20260727202504), and the UI has to be able to state the cost first.
--
-- Deactivating is the right call in almost every real case: it keeps the
-- history and simply stops the store appearing on new routes.
create or replace function public.store_delete_impact(p_store_id uuid)
returns table (
  store_name  text,
  visits      bigint,
  submissions bigint,
  photos      bigint,
  routes      bigint,
  assignments bigint,
  reps        bigint
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
    (select s.name from stores s cross join cfg
      where s.id = p_store_id and s.org_id = cfg.org),
    (select count(*) from visits v cross join cfg
      where v.store_id = p_store_id and v.org_id = cfg.org),
    (select count(*) from form_submissions f cross join cfg
      join visits v on v.id = f.visit_id
      where v.store_id = p_store_id and f.org_id = cfg.org),
    (select count(*) from photos ph cross join cfg
      join visits v on v.id = ph.visit_id
      where v.store_id = p_store_id and ph.org_id = cfg.org),
    (select count(*) from routes r cross join cfg
      where r.store_id = p_store_id and r.org_id = cfg.org),
    (select count(*) from store_assignments sa cross join cfg
      where sa.store_id = p_store_id and sa.org_id = cfg.org),
    -- How many reps lose a store from their patch.
    (select count(distinct sa.rep_id) from store_assignments sa cross join cfg
      where sa.store_id = p_store_id and sa.org_id = cfg.org);
$$;

comment on function public.store_delete_impact is
  'Rows a hard store delete would cascade away. Shown before confirming; deactivating keeps history instead.';
