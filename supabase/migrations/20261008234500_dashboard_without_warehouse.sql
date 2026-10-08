-- The dashboard's headline numbers for a company without the warehouse add-on.
--
-- dashboard_business() counted low-stock products by calling
-- low_stock_alerts(), which refuses a company without the warehouse module
-- (20261007112638). So for every such company, every new trial among them,
-- the whole function failed and the headline card said "Could not be loaded".
-- Low stock is now counted only where the warehouse module is on, and is 0
-- elsewhere; nothing else in the function changes.

do $migration$
declare
  v_def text := pg_get_functiondef('public.dashboard_business(timestamptz, timestamptz)'::regprocedure);
  c_old constant text := $a$      'low_stock', (select count(distinct product_id) from public.low_stock_alerts(null))$a$;
  c_new constant text := $b$      'low_stock', case when public.module_enabled('warehouse')
                        then (select count(distinct product_id) from public.low_stock_alerts(null))
                        else 0 end$b$;
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'dashboard_business is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$migration$;
