-- Stock control and HR, one add-on at one price (20261029233700).
--
--   S1  A plan with Stock control, HR or both costs the plan plus R495 a month
--       (R4,950 a year), in one line coded stock_control_hr, whatever the
--       number of warehouses or employees.
--   S2  The add-on is on or off: a quantity left from the per-warehouse
--       price counts once.
--   S3  Adding HR to a plan that has Stock control, or Stock control to one
--       that has HR, costs nothing until the renewal; adding the add-on to a
--       plan without it costs its share of the period.
--   S4  The old warehouse and HR prices ended when the bundle started and are
--       kept on record; no unbundled warehouse or HR price is still active.
--   S5  Every active warehouse and HR price is the bundle: flat, R495 a month
--       or R4,950 a year, no logins included, labelled "Stock control and HR".
--   S6  Paying for either switches both on (billing_apply_addons); dropping
--       it switches both off; a company that cannot have Stock control (no
--       Deliveries) gets HR alone, without an error.
--
-- HOW TO RUN: as rep_plans.sql. One DO block that always ends in
-- `raise exception`, so nothing survives. Gold Fortune stands in for a
-- company; everything it changes rolls back.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_j jsonb; v_added date;
  t record;
begin
  if to_regclass('public.price_list') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'price_list' and column_name = 'bundle') then
    raise exception 'STOCK CONTROL AND HR: SKIPPED (20261029233700 is not on this database)';
  end if;

  -- Priced as listed, not as agreed with one company.
  update public.company_account set custom_price_cents = null where org_id = c_gf;

  ---------------------------------------------------------------- S1 one line, one price
  for t in select * from (values
      ('monthly', '{"warehouse": 1}'::jsonb, 199500::bigint, 49500::bigint),
      ('monthly', '{"hr": 1}', 199500, 49500),
      ('monthly', '{"hr": 1, "warehouse": 1}', 199500, 49500),
      ('yearly',  '{"warehouse": 1}', 1995000, 495000),
      ('yearly',  '{"hr": 1, "warehouse": 1}', 1995000, 495000)) x(period, addons, base, addon)
  loop
    v_j := public.billing_lines(c_gf, t.period, public.billing_plan(5, t.addons), false);
    if jsonb_array_length(v_j->'lines') <> 2
       or (v_j->>'total_cents')::bigint <> t.base + t.addon
       or not exists (select 1 from jsonb_array_elements(v_j->'lines') l
                       where l->>'code' = 'stock_control_hr' and l->>'label' = 'Stock control and HR'
                         and (l->>'quantity')::int = 1 and (l->>'amount_cents')::bigint = t.addon) then
      v_fail := v_fail || format('S1 %s %s: %s', t.period, t.addons, v_j) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- S2 on or off
  for t in select * from (values ('{"warehouse": 2}'::jsonb), ('{"hr": 3}'), ('{"hr": 1, "warehouse": 2}')) x(addons) loop
    v_j := public.billing_lines(c_gf, 'monthly', public.billing_plan(5, t.addons), false);
    if (v_j->>'total_cents')::bigint <> 199500 + 49500 then
      v_fail := v_fail || format('S2 %s: %s (expected R495 once)', t.addons, v_j) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- S3 changing the plan
  for t in select * from (values
      ('{"warehouse": 1}'::jsonb, '{"hr": 1, "warehouse": 1}'::jsonb, false),
      ('{"hr": 1}', '{"hr": 1, "warehouse": 1}', false),
      ('{"hr": 1, "warehouse": 1}', '{"hr": 1}', false),
      ('{}', '{"hr": 1}', true),
      ('{}', '{"warehouse": 1}', true)) x(was, asked, costs)
  loop
    update public.company_account
       set status = 'active', period = 'monthly', plan = public.billing_plan(5, t.was),
           period_start = now() - interval '10 days', period_end = now() + interval '20 days', plan_next = null
     where org_id = c_gf;
    v_j := public.billing_change_lines(c_gf, public.billing_plan(5, t.asked), now());
    if t.costs then
      if (v_j->>'total_cents')::bigint not between 1 and 49500
         or jsonb_array_length(v_j->'lines') <> 1 or v_j->'lines'->0->>'code' <> 'stock_control_hr' then
        v_fail := v_fail || format('S3 %s to %s: %s (expected a share of R495)', t.was, t.asked, v_j) || E'\n';
      end if;
    elsif (v_j->>'total_cents')::bigint <> 0 then
      v_fail := v_fail || format('S3 %s to %s cost %s', t.was, t.asked, v_j->>'total_cents') || E'\n';
    end if;
    if (v_j->>'next_total_cents')::bigint <> 199500 + 49500 then
      v_fail := v_fail || format('S3 %s to %s renews at %s', t.was, t.asked, v_j->>'next_total_cents') || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- S4 old prices on record
  select min(active_from) into v_added from public.price_list where bundle = 'stock_control_hr';
  if exists (select 1 from public.price_list
              where kind = 'addon' and code in ('hr', 'warehouse') and bundle is null
                and (active_to is null or active_to > current_date)) then
    v_fail := v_fail || 'S4 an unbundled warehouse or HR price is still active' || E'\n';
  end if;
  if (select count(*) from public.price_list
       where kind = 'addon' and code in ('hr', 'warehouse') and bundle is null and active_to = v_added) <> 6 then
    v_fail := v_fail || 'S4 the six old warehouse and HR prices are not kept on record, ended when the bundle started' || E'\n';
  end if;

  ---------------------------------------------------------------- S5 the catalogue
  if (select count(*) from public.price_list
       where kind = 'addon' and code in ('hr', 'warehouse')
         and active_from <= current_date and (active_to is null or active_to > current_date)) <> 4
     or exists (select 1 from public.price_list
                 where kind = 'addon' and code in ('hr', 'warehouse')
                   and active_from <= current_date and (active_to is null or active_to > current_date)
                   and (bundle is distinct from 'stock_control_hr' or unit <> 'company' or included_users <> 0
                        or label <> 'Stock control and HR'
                        or amount_cents <> case period when 'monthly' then 49500 when 'yearly' then 495000 end)) then
    v_fail := v_fail || 'S5 the active warehouse and HR prices are not the R495 bundle' || E'\n';
  end if;

  ---------------------------------------------------------------- S6 switching on and off
  update public.company_modules set enabled = false where org_id = c_gf and module_code in ('warehouse', 'hr') and enabled;
  perform public.billing_apply_addons(c_gf, '{"warehouse": 1}'::jsonb, null);
  if (select count(*) from public.company_modules
       where org_id = c_gf and module_code in ('warehouse', 'hr') and enabled) <> 2 then
    v_fail := v_fail || 'S6 paying for Stock control did not switch both on' || E'\n';
  end if;
  perform public.billing_apply_addons(c_gf, '{}'::jsonb, array['warehouse']);
  if exists (select 1 from public.company_modules
              where org_id = c_gf and module_code in ('warehouse', 'hr') and enabled) then
    v_fail := v_fail || 'S6 dropping the add-on left one of them on' || E'\n';
  end if;
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'deliveries' and enabled;
  begin
    perform public.billing_apply_addons(c_gf, '{"hr": 1}'::jsonb, null);
    if not exists (select 1 from public.company_modules where org_id = c_gf and module_code = 'hr' and enabled)
       or exists (select 1 from public.company_modules where org_id = c_gf and module_code = 'warehouse' and enabled) then
      v_fail := v_fail || 'S6 without Deliveries, HR did not come alone' || E'\n';
    end if;
  exception when others then
    v_fail := v_fail || format('S6 without Deliveries, paying for HR failed: %s', sqlerrm) || E'\n';
  end;

  if v_fail <> '' then
    raise exception E'STOCK CONTROL AND HR FAILED:\n%', v_fail;
  end if;
  raise exception 'STOCK CONTROL AND HR: ALL PASSED (rolled back)';
end
$$;
