-- Rollback of 20261029233700_stock_control_and_hr_one_price: the warehouse and
-- HR add-ons priced apart again. billing_lines first (it reads the column),
-- by the same anchored replace the other way round; then the bundle rows go,
-- the rows they ended are open again, and the column goes.

do $$
declare
  def text := pg_get_functiondef('public.billing_lines(uuid, text, jsonb, boolean)'::regprocedure);
  anchor constant text := $a$
    if v_row.unit = 'employees' then
$a$;
  branch constant text := $b$
    -- Add-ons sold together at one price (price_list.bundle, 20261029233700):
    -- one line for the bundle, coded with it, however many of its add-ons
    -- the plan has.
    if v_row.bundle is not null then
      if v_qty <> 1 then
        raise exception 'Add-on % is on or off (quantity 1).', a.key using errcode = '22023';
      end if;
      continue when exists (select 1 from jsonb_array_elements(v_lines) l where l->>'code' = v_row.bundle);
      v_lines := v_lines || jsonb_build_object('code', v_row.bundle, 'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents);
      continue;
    end if;
$b$;
  added date;
begin
  if (length(def) - length(replace(def, branch || substr(anchor, 2), ''))) / length(branch || substr(anchor, 2)) <> 1 then
    raise exception 'billing_lines: expected 1 of the bundle branch';
  end if;
  execute replace(def, branch || substr(anchor, 2), anchor);

  select min(active_from) into added from public.price_list where bundle = 'stock_control_hr';
  delete from public.price_list where bundle = 'stock_control_hr';
  update public.price_list
     set active_to = null
   where kind = 'addon' and code in ('hr', 'warehouse') and active_to = added;
end;
$$;

alter table public.price_list
  drop constraint price_list_bundle_addon,
  drop column bundle;
