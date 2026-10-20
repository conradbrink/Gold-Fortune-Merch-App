-- Sales are invoices suite (20261020213700, owner 20 Oct 2026).
--
--   S1  Live data: sales_documents adds up to the issued invoices less credit
--       notes, read straight from the tables; every document's lines add up
--       to its subtotal; every line has its own line_id.
--   S2  Fixtures land as they should: an invoice valued on its lines with a
--       "box of 10" line counted as 10 units and costed from its order lines;
--       a credit note as a negative on its own date; a voided invoice left
--       out; an invoice with no order (no rep, cost unknown); a rebate credit
--       note with no lines.
--   S3  The day: an invoice counts on the company's day it was issued, and
--       `to` is exclusive.
--   S4  Every figure reads the one rule: the dashboard's revenue, count and
--       month; targets; the rep report's summary, days, stores and missed
--       rounds.
--   S5  store_health: an invoice with no order behind it is an order on that
--       day, so 70 days ago is "stopped ordering" and 10 days ago is not.
--   S6  A rep without invoice access reads no invoices.
--   S7  Grants, security invoker and the module registration.
--   S8  A company without invoicing counts delivered orders, as before.
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_tz text;
  v_today date;
  v_mgr uuid; v_rep uuid; v_product uuid; v_product2 uuid;
  v_s uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid;
  v_o uuid; v_l1 uuid; v_l2 uuid;
  v_a uuid; v_a1 uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid;
  v_month timestamptz; v_day timestamptz; v_next timestamptz;
  v_n bigint; v_x numeric; v_y numeric; v_z numeric;
  v_j jsonb;
  r record;
begin
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active
     and exists (select 1 from public.profile_permissions pp
                  where pp.profile_id = profiles.id and pp.permission_code = 'invoicing')
   order by created_at limit 1;
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by created_at limit 1;
  select id into v_product from public.products where org_id = c_gf order by created_at, id limit 1;
  select id into v_product2 from public.products where org_id = c_gf order by created_at, id offset 1 limit 1;
  if v_mgr is null or v_rep is null or v_product2 is null then
    raise exception 'Fixtures missing: a Gold Fortune manager with invoicing, a rep and two products are needed.';
  end if;
  v_tz := public.org_timezone(c_gf);
  v_today := (now() at time zone v_tz)::date;
  v_day := v_today::timestamp at time zone v_tz;
  v_next := (v_today + 1)::timestamp at time zone v_tz;
  v_month := date_trunc('month', v_today)::timestamp at time zone v_tz;

  ---------------------------------------------------------------- fixtures
  insert into public.stores (org_id, name) values (c_gf, 'ZZ sales A ordered') returning id into v_s;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ sales C no order') returning id into v_s2;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ sales D 70 days') returning id into v_s3;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ sales E 10 days') returning id into v_s4;

  insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via, client_generated_id)
  values (c_gf, 'ZZ-SALES-1', v_s, v_rep, 'rep_app', 'other', gen_random_uuid()) returning id into v_o;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o, v_product, 3, 100, gen_random_uuid()) returning id into v_l1;
  insert into public.order_lines (org_id, order_id, product_id, qty_ordered, unit_price, client_generated_id)
  values (c_gf, v_o, v_product2, 10, 100, gen_random_uuid()) returning id into v_l2;
  update public.order_lines set unit_cost_excl_vat = 60 where id = v_l1;
  update public.order_lines set unit_cost_excl_vat = 80 where id = v_l2;

  -- A: issued three days ago, P1,300: 3 @ 100 and one box of 10 @ 1,000.
  insert into public.tax_invoices (org_id, invoice_number, order_id, order_number, store_id, source,
                                   seller_name, customer_name, issue_date, due_date, vat_rate,
                                   subtotal, vat, total)
  values (c_gf, 'ZZ-SALES-A', v_o, 'ZZ-SALES-1', v_s, 'order', 'Suite', 'ZZ sales A',
          v_today - 3, v_today + 27, 14, 1300, 182, 1482) returning id into v_a;
  insert into public.tax_invoice_lines (invoice_id, position, product_id, description, qty, unit_price, line_total, order_line_id)
  values (v_a, 1, v_product, 'Sticks', 3, 100, 300, v_l1) returning id into v_a1;
  insert into public.tax_invoice_lines (invoice_id, position, product_id, description, qty, unit, unit_price, line_total, order_line_id)
  values (v_a, 2, v_product2, 'A box', 1, 'box of 10', 1000, 1000, v_l2);
  -- One stick back, yesterday.
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total)
  values (c_gf, 'ZZ-SALES-CN-A', v_a, 'Suite', v_today - 1, 100, 14, 114);
  insert into public.credit_note_lines (credit_note_id, invoice_line_id, qty, unit_price, line_total)
  select id, v_a1, 1, 100, 100 from public.credit_notes where credit_number = 'ZZ-SALES-CN-A' and org_id = c_gf;

  -- B: voided, never a sale.
  insert into public.tax_invoices (org_id, invoice_number, store_id, source, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total, status, void_reason)
  values (c_gf, 'ZZ-SALES-B', v_s, 'direct', 'Suite', 'ZZ sales A', v_today - 3, v_today + 27, 14,
          999, 139.86, 1138.86, 'void', 'Suite') returning id into v_b;
  insert into public.tax_invoice_lines (invoice_id, position, description, qty, unit_price, line_total)
  values (v_b, 1, 'Void', 1, 999, 999);

  -- C: no order behind it, and a rebate credit note with no lines.
  insert into public.tax_invoices (org_id, invoice_number, store_id, source, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (c_gf, 'ZZ-SALES-C', v_s2, 'direct', 'Suite', 'ZZ sales C', v_today - 2, v_today + 28, 14,
          200, 28, 228) returning id into v_c;
  insert into public.tax_invoice_lines (invoice_id, position, description, qty, unit_price, line_total)
  values (v_c, 1, 'Typed in', 2, 100, 200);
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total)
  values (c_gf, 'ZZ-SALES-CN-C', v_c, 'Rebate', v_today - 2, 50, 7, 57);

  -- D and E: invoice-only stores, 70 and 10 days ago.
  insert into public.tax_invoices (org_id, invoice_number, store_id, source, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (c_gf, 'ZZ-SALES-D', v_s3, 'direct', 'Suite', 'ZZ sales D', v_today - 70, v_today - 40, 14,
          10, 1.4, 11.4) returning id into v_d;
  insert into public.tax_invoices (org_id, invoice_number, store_id, source, seller_name, customer_name,
                                   issue_date, due_date, vat_rate, subtotal, vat, total)
  values (c_gf, 'ZZ-SALES-E', v_s4, 'direct', 'Suite', 'ZZ sales E', v_today - 10, v_today + 20, 14,
          10, 1.4, 11.4) returning id into v_e;
  insert into public.tax_invoice_lines (invoice_id, position, description, qty, unit_price, line_total)
  values (v_d, 1, 'Old', 1, 10, 10), (v_e, 1, 'Recent', 1, 10, 10);

  -- A round at A's store yesterday that nobody went to.
  insert into public.routes (org_id, rep_id, store_id, scheduled_date)
  values (c_gf, v_rep, v_s, v_today - 1);

  ---------------------------------------------------------------- read as the manager
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- S1 live totals
  select coalesce(sum(subtotal), 0) into v_x from public.tax_invoices where org_id = c_gf and status = 'issued';
  select v_x - coalesce(sum(c.subtotal), 0) into v_x
    from public.credit_notes c join public.tax_invoices i on i.id = c.invoice_id
   where c.org_id = c_gf and i.status = 'issued';
  select sum(revenue_excl_vat) into v_y from public.sales_documents();
  v_z := v_y;
  if v_x is distinct from v_y then
    v_fail := v_fail || format('S1 all time: invoices less credit notes %s, sales_documents %s', v_x, v_y) || E'\n';
  end if;
  select count(*) into v_n
    from public.sales_documents() d
    join (select doc_id, sum(net) as net from public.sales_lines() group by doc_id) l using (doc_id)
   where round(l.net, 2) <> d.revenue_excl_vat;
  if v_n > 0 then
    v_fail := v_fail || format('S1 %s documents whose lines do not add up to their revenue', v_n) || E'\n';
  end if;
  -- line_id is what the AI Manager pages by: one row each.
  select count(*) - count(distinct line_id) into v_n from public.sales_lines();
  if v_n <> 0 then
    v_fail := v_fail || format('S1 %s sales_lines rows share a line_id', v_n) || E'\n';
  end if;
  select count(*) into v_n
    from public.sales_documents() d
    join public.tax_invoices i on i.id = d.doc_id
   where d.doc_kind = 'invoice' and (d.revenue_excl_vat <> i.subtotal or d.revenue_incl_vat <> i.total);
  if v_n > 0 then
    v_fail := v_fail || format('S1 %s invoices not valued at their subtotal and total', v_n) || E'\n';
  end if;

  ---------------------------------------------------------------- S2 fixtures
  select * into r from public.sales_documents() where doc_id = v_a;
  if r.doc_id is null then
    v_fail := v_fail || 'S2 invoice A is missing' || E'\n';
  elsif (r.doc_kind, r.revenue_excl_vat, r.revenue_incl_vat, r.units, r.gross_profit, r.uncosted_units, r.rep_id, r.issued_on)
        is distinct from ('invoice'::text, 1300::numeric, 1482::numeric, 13::numeric, 320::numeric, 0::numeric, v_rep, v_today - 3) then
    v_fail := v_fail || format('S2 invoice A: %s', row_to_json(r)) || E'\n';
  end if;
  select * into r from public.sales_documents() where doc_number = 'ZZ-SALES-CN-A';
  if r.doc_id is null then
    v_fail := v_fail || 'S2 credit note on A is missing' || E'\n';
  elsif (r.doc_kind, r.invoice_id, r.revenue_excl_vat, r.revenue_incl_vat, r.units, r.gross_profit, r.rep_id, r.issued_on)
        is distinct from ('credit_note'::text, v_a, -100::numeric, -114::numeric, -1::numeric, -40::numeric, v_rep, v_today - 1) then
    v_fail := v_fail || format('S2 credit note on A: %s', row_to_json(r)) || E'\n';
  end if;
  if exists (select 1 from public.sales_documents() where doc_id = v_b) then
    v_fail := v_fail || 'S2 the voided invoice B counts' || E'\n';
  end if;
  select * into r from public.sales_documents() where doc_id = v_c;
  if (r.revenue_excl_vat, r.units, r.gross_profit, r.uncosted_units, r.rep_id)
     is distinct from (200::numeric, 2::numeric, 200::numeric, 2::numeric, null::uuid) then
    v_fail := v_fail || format('S2 invoice C: %s', row_to_json(r)) || E'\n';
  end if;
  select * into r from public.sales_documents() where doc_number = 'ZZ-SALES-CN-C';
  if (r.doc_kind, r.revenue_excl_vat, r.revenue_incl_vat, r.units)
     is distinct from ('credit_note'::text, -50::numeric, -57::numeric, 0::numeric) then
    v_fail := v_fail || format('S2 rebate on C: %s', row_to_json(r)) || E'\n';
  end if;
  select sum(units) into v_x from public.sales_lines() where doc_id = v_a and product_id = v_product2;
  if v_x is distinct from 10::numeric then
    v_fail := v_fail || format('S2 the box of 10 is %s units', v_x) || E'\n';
  end if;

  ---------------------------------------------------------------- S3 the day
  if not exists (select 1 from public.sales_documents(v_day - interval '3 days', v_day - interval '2 days') where doc_id = v_a) then
    v_fail := v_fail || 'S3 A is not in the day it was issued' || E'\n';
  end if;
  if exists (select 1 from public.sales_documents(v_day - interval '2 days', null) where doc_id = v_a)
     or exists (select 1 from public.sales_documents(null, v_day - interval '3 days') where doc_id = v_a) then
    v_fail := v_fail || 'S3 A counts outside the day it was issued' || E'\n';
  end if;
  -- A range ending part-way through a day takes that day.
  if not exists (select 1 from public.sales_documents(v_day - interval '4 days', v_day - interval '3 days' + interval '1 hour') where doc_id = v_a) then
    v_fail := v_fail || 'S3 a range ending at 01:00 leaves out that day' || E'\n';
  end if;

  ---------------------------------------------------------------- S4 the figures
  v_j := public.dashboard_business(v_month, v_next) -> 'revenue';
  select coalesce(sum(revenue_excl_vat), 0), count(*) filter (where doc_kind <> 'credit_note')
    into v_x, v_n from public.sales_documents(v_month, v_next);
  if (v_j ->> 'current')::numeric is distinct from v_x or (v_j ->> 'orders')::bigint is distinct from v_n then
    v_fail := v_fail || format('S4 dashboard revenue %s / %s invoices, sales_documents %s / %s',
                               v_j ->> 'current', v_j ->> 'orders', v_x, v_n) || E'\n';
  end if;
  select coalesce(sum(revenue_excl_vat), 0) into v_x from public.sales_documents(v_month, null);
  if ((v_j -> 'by_month' -> -1) ->> 'net')::numeric is distinct from round(v_x, 2) then
    v_fail := v_fail || format('S4 dashboard month %s, sales_documents %s', (v_j -> 'by_month' -> -1) ->> 'net', v_x) || E'\n';
  end if;
  select coalesce(sum(revenue_excl_vat), 0) into v_x
    from public.sales_documents(v_month - (v_next - v_month), v_month);
  if (v_j ->> 'previous')::numeric is distinct from v_x then
    v_fail := v_fail || format('S4 dashboard previous %s, sales_documents %s', v_j ->> 'previous', v_x) || E'\n';
  end if;

  select coalesce(sum(revenue_excl_vat), 0), count(*) filter (where doc_kind <> 'credit_note')
    into v_x, v_n from public.sales_documents(v_month, (date_trunc('month', v_today) + interval '1 month')::timestamp at time zone v_tz)
   where rep_id = v_rep;
  select * into r from public.sales_target_progress(v_today) t where t.rep_id = v_rep;
  if (r.revenue_excl_vat, r.orders) is distinct from (v_x, v_n) then
    v_fail := v_fail || format('S4 target %s / %s, sales_documents %s / %s', r.revenue_excl_vat, r.orders, v_x, v_n) || E'\n';
  end if;

  select coalesce(round(sum(revenue_excl_vat), 2), 0), count(*) filter (where doc_kind <> 'credit_note')
    into v_x, v_n from public.sales_documents(v_day - interval '7 days', v_next) where rep_id = v_rep;
  select * into r from public.rep_performance_summary(v_rep, v_day - interval '7 days', v_next, null);
  if (r.sales_net, r.sales_orders) is distinct from (v_x, v_n) then
    v_fail := v_fail || format('S4 rep summary %s / %s, sales_documents %s / %s', r.sales_net, r.sales_orders, v_x, v_n) || E'\n';
  end if;
  select * into r from public.rep_performance_stores(v_rep, v_day - interval '7 days', v_next, null) where store_id = v_s;
  if (r.sales_net, r.sales_orders) is distinct from (1200::numeric, 1::bigint) then
    v_fail := v_fail || format('S4 rep store A %s / %s, expected 1200 / 1', r.sales_net, r.sales_orders) || E'\n';
  end if;
  select * into r from public.rep_performance_daily(v_rep, v_day - interval '7 days', v_next, null) where day = v_today - 3;
  select coalesce(round(sum(revenue_excl_vat), 2), 0) into v_x
    from public.sales_documents(v_day - interval '3 days', v_day - interval '2 days') where rep_id = v_rep;
  if r.sales_net is distinct from v_x then
    v_fail := v_fail || format('S4 rep day %s, sales_documents %s', r.sales_net, v_x) || E'\n';
  end if;
  select * into r from public.rep_performance_missed(v_rep, v_day - interval '7 days', v_next, null) where store_id = v_s;
  if r.previous_sales is distinct from 1200::numeric then
    v_fail := v_fail || format('S4 missed round at A: previous sale %s, expected 1200 (A less its credit)', r.previous_sales) || E'\n';
  end if;

  ---------------------------------------------------------------- S5 store_health
  select * into r from public.store_health() h where h.store_id = v_s3;
  if (r.lapsed, r.last_order_at) is distinct from (true, (v_today - 70)::timestamp at time zone v_tz) then
    v_fail := v_fail || format('S5 D (invoiced 70 days ago): lapsed %s, last order %s', r.lapsed, r.last_order_at) || E'\n';
  end if;
  select * into r from public.store_health() h where h.store_id = v_s4;
  if r.lapsed is distinct from false or r.days_since_order is distinct from 10 then
    v_fail := v_fail || format('S5 E (invoiced 10 days ago): lapsed %s, %s days', r.lapsed, r.days_since_order) || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- S6 a rep
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.has_permission('invoicing') and not public.has_permission('warehouse') then
    select count(*) into v_n from public.sales_documents() where doc_kind <> 'order';
    if v_n > 0 then
      v_fail := v_fail || format('S6 a rep without invoice access reads %s invoices', v_n) || E'\n';
    end if;
  end if;
  reset role;

  ---------------------------------------------------------------- S7 grants
  for r in select unnest(array['public.sales_lines(timestamptz,timestamptz)',
                               'public.sales_documents(timestamptz,timestamptz)']) as f loop
    if (select prosecdef from pg_proc where oid = r.f::regprocedure) then
      v_fail := v_fail || format('S7 %s is security definer', r.f) || E'\n';
    end if;
    if has_function_privilege('anon', r.f, 'execute') then
      v_fail := v_fail || format('S7 anon can call %s', r.f) || E'\n';
    end if;
    if not has_function_privilege('authenticated', r.f, 'execute') then
      v_fail := v_fail || format('S7 authenticated cannot call %s', r.f) || E'\n';
    end if;
  end loop;
  if (select count(*) from public.module_assignments
       where kind = 'function' and name in ('sales_lines', 'sales_documents') and module_code = 'core') <> 2 then
    v_fail := v_fail || 'S7 sales_lines and sales_documents are not registered as core' || E'\n';
  end if;

  ---------------------------------------------------------------- S8 no invoicing
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'invoicing';
  select coalesce(sum((ol.qty_delivered - ol.qty_returned) * coalesce(ol.unit_price, 0)), 0) into v_x
    from public.orders o join public.order_lines ol on ol.order_id = o.id
   where o.org_id = c_gf and o.status = 'delivered' and o.delivered_at is not null
     and ol.qty_delivered - ol.qty_returned > 0;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce(sum(revenue_excl_vat), 0), count(*) filter (where doc_kind <> 'order')
    into v_y, v_n from public.sales_documents();
  reset role;
  if round(v_x, 2) is distinct from v_y or v_n > 0 then
    v_fail := v_fail || format('S8 without invoicing: delivered %s, sales_documents %s (%s not orders)', v_x, v_y, v_n) || E'\n';
  end if;

  raise exception '%', case when v_fail = ''
    then format('SALES INVOICED SUITE PASSED (all time %s, delivered orders alone %s)', v_z, v_y)
    else E'SALES INVOICED SUITE FAILED\n' || v_fail end;
end;
$$;
