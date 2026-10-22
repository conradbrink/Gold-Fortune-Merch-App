-- What is in a delivery, for the rep it was given to (22 Oct 2026).
--
-- The gap: a rep could see the deliveries the warehouse had put their name on
-- (20260827165536) but could not open one. The products are on `order_lines`,
-- and `order_lines` admits a rep only to the orders *they took*. A rep is
-- often given drops for orders their colleagues or the office took, so a
-- screen that asked would have come back empty for most of them.
--
-- A function rather than a wider `order_lines_select`. The policy would hand
-- the rep every column of the line, the pricing included, and the reason
-- 20260827165536 left `order_lines` alone still holds: a rep handling somebody
-- else's order has no business with what the shop is paying for it. This
-- returns the product and the quantities and nothing else.
--
-- SECURITY DEFINER, deliberately (README rule 1 is security invoker), for the
-- reason above, as store_reorder() and store_range() do. So it checks what RLS
-- would have: the module, the company, and who may see the dispatch — the rep
-- it is assigned to, or anyone with the warehouse permission, the same two
-- clauses as `dispatches_select` (delivery_contents.sql C8 checks they agree).
--
-- One row per order line. The warehouse ships an order line as one dispatch
-- line per allocation, and an allocation per batch it drew from, so a line
-- taken from two batches arrives as two rows; summed here, the rep sees the
-- product once, with the quantity the shop asked for beside it.

create or replace function public.delivery_contents(p_dispatch uuid)
returns table (
  product_name text,
  brand text,
  sku_code text,
  units_per_shrink integer,
  qty integer,
  qty_ordered integer,
  qty_delivered integer,
  qty_returned integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.current_org_id();
begin
  -- First, so a company without the module is told so whatever it passes
  -- (module_enforcement.sql M3 calls this with a null). Warehouse cannot be on
  -- without Distribution (company_modules_guard), whose tables this also reads.
  perform public.require_module('warehouse');

  if not exists (
    select 1 from public.dispatches d
     where d.id = p_dispatch
       and d.org_id = v_org
       and (public.has_permission('warehouse') or d.assigned_rep_id = auth.uid())
  ) then
    raise exception 'That delivery is not assigned to you.' using errcode = '42501';
  end if;

  return query
  select pr.name, pr.brand, pr.sku_code, pr.units_per_shrink,
         sum(dl.qty)::integer,
         ol.qty_ordered,
         sum(coalesce(dl.qty_delivered, 0))::integer,
         sum(coalesce(dl.qty_returned, 0))::integer
    from public.dispatch_lines dl
    join public.order_lines ol on ol.id = dl.order_line_id and ol.org_id = v_org
    join public.products pr on pr.id = ol.product_id and pr.org_id = v_org
   where dl.dispatch_id = p_dispatch
     and dl.org_id = v_org
   group by ol.id, pr.id
   order by pr.name, ol.id;
end;
$$;

revoke all on function public.delivery_contents(uuid) from public, anon;
grant execute on function public.delivery_contents(uuid) to authenticated, service_role;

comment on function public.delivery_contents(uuid) is
  'The products and quantities on one dispatch, one row per order line, without prices, for the rep it is assigned to or the warehouse. The phone''s delivery screen reads it, because order_lines admits a rep only to orders they took.';

-- README rule 4: every authenticated-callable function belongs to a module.
insert into public.module_assignments (kind, name, module_code)
values ('function', 'delivery_contents', 'warehouse')
on conflict do nothing;
