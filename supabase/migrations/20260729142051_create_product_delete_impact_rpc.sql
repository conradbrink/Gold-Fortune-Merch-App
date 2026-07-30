-- What deleting a product would destroy.
--
-- `promotion_products.product_id` and `promotion_checks.product_id` both
-- cascade, so removing a line erases every answer ever recorded against it —
-- including answers on promotions that finished months ago, whose figures then
-- change retroactively. That is the same trap `store_delete_impact`
-- (20260728145421) and `rep_delete_impact` (20260727202504) exist for, and the
-- dialog has to be able to state the cost before anyone confirms it.
--
-- Deactivating is the right call in almost every real case: a discontinued line
-- keeps its history and simply stops appearing when someone builds the next
-- promotion.
create or replace function public.product_delete_impact(p_product_id uuid)
returns table (
  product_name       text,
  promotions         bigint,
  promotions_live    bigint,
  checks             bigint,
  stores_answered    bigint
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
    (select p.name from products p cross join cfg
      where p.id = p_product_id and p.org_id = cfg.org),
    (select count(*) from promotion_products pp cross join cfg
      join promotions pr on pr.id = pp.promotion_id
      where pp.product_id = p_product_id and pr.org_id = cfg.org),
    -- Promotions running right now are the ones a rep could be standing in
    -- front of, so they are worth naming separately from finished ones.
    (select count(*) from promotion_products pp cross join cfg
      join promotions pr on pr.id = pp.promotion_id
      where pp.product_id = p_product_id and pr.org_id = cfg.org
        and pr.active
        and current_date between pr.starts_on and pr.ends_on),
    (select count(*) from promotion_checks pc cross join cfg
      where pc.product_id = p_product_id and pc.org_id = cfg.org),
    (select count(distinct pc.store_id) from promotion_checks pc cross join cfg
      where pc.product_id = p_product_id and pc.org_id = cfg.org);
$$;

comment on function public.product_delete_impact is
  'Rows a hard product delete would cascade away, including answers on finished promotions whose figures would change retroactively. Shown before confirming; deactivating keeps history instead.';
