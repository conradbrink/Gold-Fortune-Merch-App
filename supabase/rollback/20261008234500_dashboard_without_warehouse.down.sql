-- Rollback of 20261008234500_dashboard_without_warehouse: low stock counted
-- unconditionally again (which fails for a company without the warehouse
-- module).

do $rollback$
declare
  v_def text := pg_get_functiondef('public.dashboard_business(timestamptz, timestamptz)'::regprocedure);
  c_new constant text := $b$      'low_stock', case when public.module_enabled('warehouse')
                        then (select count(distinct product_id) from public.low_stock_alerts(null))
                        else 0 end$b$;
  c_old constant text := $a$      'low_stock', (select count(distinct product_id) from public.low_stock_alerts(null))$a$;
begin
  if (length(v_def) - length(replace(v_def, c_new, ''))) / length(c_new) <> 1 then
    raise exception 'dashboard_business is not the text this rollback expects';
  end if;
  execute replace(v_def, c_new, c_old);
end;
$rollback$;
