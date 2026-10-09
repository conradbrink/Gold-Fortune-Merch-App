-- Sending money documents suite (Stage 8.10, 9 Oct 2026).
--
--   T1  Addresses: one that is not an email address, none, and more than five
--       are refused; a copy to the sender is added only when asked for.
--   T2  An invoice: queues one email per address (template invoice, linked to
--       the invoice), the same link on a second send, a voided invoice and
--       another company's refused, a blocked address reported and not queued.
--   T3  A quote: a draft becomes sent; a declined one and one with no lines
--       are refused; the amount is the document's own total.
--   T4  A statement: the link holds the period, the balance is the closing
--       balance of the statement, a client with no invoices and bad dates are
--       refused.
--   T5  A reminder: lists what is overdue, refused when nothing is, for a bad
--       tone or an empty message.
--   T6  The page the client opens (service role): invoice (what is still to
--       pay), quote, statement (the same rows as client_statement); null when
--       voided, expired or withdrawn; openings are counted.
--   T7  What was sent: the list for one document and the summary per client.
--   T8  Who may: an employee without invoicing, the module off, anon, and the
--       server-only functions refused to signed-in people.
--   T9  Grants, registration and the accounts flag on site contacts.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_admin uuid; v_admin_email text; v_staff uuid;
  v_s1 uuid; v_s2 uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_ivoid uuid;
  v_q1 uuid; v_q2 uuid; v_q3 uuid; v_q4 uuid; v_p1 uuid; v_p2 uuid;
  v_r jsonb; v_r2 jsonb; v_link uuid; v_n int; v_t numeric; v_qt numeric; v_j jsonb; v_j2 jsonb;
  v_ok boolean; v_today date;
begin
  select p.id, p.email into v_admin, v_admin_email from public.profiles p
    join public.profile_permissions pp on pp.profile_id = p.id
   where p.org_id = c_gf and p.is_active and pp.permission_code = 'admin' limit 1;
  select p.id into v_staff from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager' and p.id <> v_admin
     and not exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_code in ('admin', 'invoicing'))
   limit 1;
  select s.id into v_s1 from public.stores s where s.org_id = c_gf order by s.created_at limit 1;
  select s.id into v_s2 from public.stores s where s.org_id = c_gf and s.id <> v_s1 order by s.created_at limit 1;
  select p.id into v_p1 from public.products p where p.org_id = c_gf order by p.created_at limit 1;
  select p.id into v_p2 from public.products p where p.org_id = c_gf and p.id <> v_p1 order by p.created_at limit 1;
  if v_admin is null or v_s2 is null or v_p2 is null then
    raise exception 'Fixtures missing: admin %, stores %, %, products %, %', v_admin, v_s1, v_s2, v_p1, v_p2;
  end if;
  v_today := (now() at time zone public.org_timezone(c_gf))::date;

  ---------------------------------------------------------------- fixtures
  -- Place one: an invoice due 40 days ago (overdue), one paid in full, one voided.
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, store_id, issue_date, due_date, vat_rate, subtotal, vat, total, source)
  values (c_gf, 'ZZ-T-1', 'Seller', 'Place one', v_s1, v_today - 70, v_today - 40, 14, 877.19, 122.81, 1000, 'direct') returning id into v_i1;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method) values (c_gf, v_i1, 300, v_today - 20, 'eft');
  insert into public.credit_notes (org_id, credit_number, invoice_id, reason, issue_date, subtotal, vat, total)
  values (c_gf, 'ZZ-T-CN1', v_i1, 'Returned', v_today - 15, 87.72, 12.28, 100);
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, store_id, issue_date, due_date, vat_rate, subtotal, vat, total, source)
  values (c_gf, 'ZZ-T-2', 'Seller', 'Place one', v_s1, v_today - 30, v_today - 5, 14, 175.44, 24.56, 200, 'direct') returning id into v_i2;
  insert into public.invoice_payments (org_id, invoice_id, amount, paid_on, method) values (c_gf, v_i2, 200, v_today - 2, 'cash');
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, store_id, issue_date, due_date, vat_rate, subtotal, vat, total, source, status, void_reason)
  values (c_gf, 'ZZ-T-V', 'Seller', 'Place one', v_s1, v_today - 10, v_today + 20, 14, 87.72, 12.28, 100, 'direct', 'void', 'Test') returning id into v_ivoid;
  -- A client with no place, nothing overdue (due in future).
  insert into public.tax_invoices (org_id, invoice_number, seller_name, customer_name, issue_date, due_date, vat_rate, subtotal, vat, total, source)
  values (c_gf, 'ZZ-T-3', 'Seller', 'ZZ Walk-in', v_today - 2, v_today + 28, 14, 87.72, 12.28, 100, 'direct') returning id into v_i3;
  -- Quotes: a draft with two lines, a declined one, one with no lines.
  insert into public.quotes (org_id, quote_number, store_id, status) values (c_gf, 'ZZ-TQ-1', v_s1, 'draft') returning id into v_q1;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price) values (c_gf, v_q1, 1, v_p1, 10, 59.95);
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price, discount_amount) values (c_gf, v_q1, 2, v_p2, 3, 20, 5);
  insert into public.quotes (org_id, quote_number, store_id, status) values (c_gf, 'ZZ-TQ-2', v_s1, 'draft') returning id into v_q2;
  insert into public.quote_lines (org_id, quote_id, position, product_id, qty, list_price) values (c_gf, v_q2, 1, v_p1, 1, 10);
  update public.quotes set status = 'declined' where id = v_q2;
  insert into public.quotes (org_id, quote_number, store_id, status) values (c_gf, 'ZZ-TQ-3', v_s1, 'draft') returning id into v_q3;
  -- A blocked address.
  insert into public.message_suppressions (org_id, address, reason) values (null, 'blocked-zz@example.com', 'hard_bounce');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- T1 addresses
  begin
    perform public.send_invoice_email(v_i1, array['not an address'], null, false);
    v_fail := v_fail || 'T1 a bad address was accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_invoice_email(v_i1, array[]::text[], null, false);
    v_fail := v_fail || 'T1 no address was accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_invoice_email(v_i1, array['a@example.com','b@example.com','c@example.com','d@example.com','e@example.com','f@example.com'], null, false);
    v_fail := v_fail || 'T1 six addresses were accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;

  ---------------------------------------------------------------- T2 an invoice
  v_r := public.send_invoice_email(v_i1, array['Client@Example.com ', 'client@example.com', 'second@example.com'], 'Thank you', false);
  reset role;
  select count(*) into v_n from public.message_outbox
   where org_id = c_gf and template = 'invoice' and related_kind = 'invoice' and related_id = v_i1 and status = 'queued';
  if (v_r ->> 'queued')::int <> 2 or v_n <> 2 or jsonb_array_length(v_r -> 'suppressed') <> 0 then
    v_fail := v_fail || format('T2 the first send queued %s (%s rows), want 2', v_r ->> 'queued', v_n) || E'\n';
  end if;
  v_link := (v_r ->> 'link_id')::uuid;
  if not exists (select 1 from public.message_outbox o
                  where o.related_id = v_i1 and o.to_address = 'client@example.com'
                    and o.payload ->> 'number' = 'ZZ-T-1' and (o.payload ->> 'total')::numeric = 1000
                    and o.payload ->> 'currency' is not null and o.payload ->> 'note' = 'Thank you'
                    and o.payload ->> 'link_id' = v_link::text) then
    v_fail := v_fail || 'T2 the invoice email payload is wrong' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r2 := public.send_invoice_email(v_i1, array['blocked-zz@example.com', 'third@example.com'], null, true);
  reset role;
  if (v_r2 ->> 'link_id')::uuid <> v_link then
    v_fail := v_fail || 'T2 a second send made a second link' || E'\n';
  end if;
  -- third@ and the sender's own copy are queued; the blocked address is reported, not queued.
  v_n := case when v_admin_email is null then 1 else 2 end;
  if not ((v_r2 -> 'suppressed') ? 'blocked-zz@example.com') or (v_r2 ->> 'queued')::int <> v_n then
    v_fail := v_fail || format('T2 the blocked address was not reported: %s', v_r2::text) || E'\n';
  end if;
  if v_admin_email is not null and not exists (select 1 from public.message_outbox where related_id = v_i1 and to_address = lower(btrim(v_admin_email))) then
    v_fail := v_fail || 'T2 "send me a copy" did not copy the sender' || E'\n';
  end if;
  if exists (select 1 from public.message_outbox where related_id = v_i1 and to_address = lower(btrim(coalesce(v_admin_email, 'x')))) and
     (select count(*) from public.message_outbox where related_id = v_i1 and to_address = 'client@example.com') <> 1 then
    v_fail := v_fail || 'T2 an address got the same email twice from one send' || E'\n';
  end if;
  if (select count(*) from public.document_links where invoice_id = v_i1) <> 1 then
    v_fail := v_fail || 'T2 more than one link for one invoice' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_invoice_email(v_ivoid, array['x@example.com'], null, false);
    v_fail := v_fail || 'T2 a voided invoice was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_invoice_email(gen_random_uuid(), array['x@example.com'], null, false);
    v_fail := v_fail || 'T2 an invoice that does not exist was sent' || E'\n';
  exception when sqlstate 'P0002' then null;
  end;

  ---------------------------------------------------------------- T3 a quote
  v_r := public.send_quote_email(v_q1, array['quote@example.com'], null, false);
  reset role;
  select coalesce(sum(round(l.qty * l.unit_price, 2)), 0) into v_qt from public.quote_lines l where l.quote_id = v_q1;
  select (select t.total from public.money_totals(v_qt, q.vat_rate, q.prices_include_vat) t) into v_qt from public.quotes q where q.id = v_q1;
  if (select status from public.quotes where id = v_q1) <> 'sent' or (select sent_at from public.quotes where id = v_q1) is null then
    v_fail := v_fail || 'T3 sending a draft quote did not mark it sent' || E'\n';
  end if;
  if not exists (select 1 from public.message_outbox o where o.related_id = v_q1 and o.template = 'quote'
                  and (o.payload ->> 'total')::numeric = v_qt and o.payload ->> 'number' = 'ZZ-TQ-1') then
    v_fail := v_fail || format('T3 the quote email is wrong (want total %s)', v_qt) || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_quote_email(v_q2, array['x@example.com'], null, false);
    v_fail := v_fail || 'T3 a declined quote was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_quote_email(v_q3, array['x@example.com'], null, false);
    v_fail := v_fail || 'T3 a quote with no lines was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  perform public.send_quote_email(v_q1, array['quote@example.com'], null, false);  -- an already sent quote can be sent again
  if (select status from public.quotes where id = v_q1) <> 'sent' then
    v_fail := v_fail || 'T3 sending a sent quote again changed its status' || E'\n';
  end if;

  ---------------------------------------------------------------- T4 a statement
  v_r := public.send_statement_email(v_s1, null, v_today - 90, v_today, array['stmt@example.com'], null, false);
  select (array_agg(x.balance order by x.ordinality desc))[1] into v_t
    from public.client_statement(v_s1, null, v_today - 90, v_today) with ordinality as x;
  reset role;
  if not exists (select 1 from public.document_links l where l.id = (v_r ->> 'link_id')::uuid and l.kind = 'statement'
                  and l.store_id = v_s1 and l.period_from = v_today - 90 and l.period_to = v_today)
     or not exists (select 1 from public.message_outbox o where o.template = 'statement' and o.to_address = 'stmt@example.com'
                     and (o.payload ->> 'balance')::numeric = v_t) then
    v_fail := v_fail || format('T4 the statement link or email is wrong (closing balance %s)', v_t) || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r2 := public.send_statement_email(v_s1, null, v_today - 90, v_today, array['stmt2@example.com'], null, false);
  if (v_r2 ->> 'link_id') <> (v_r ->> 'link_id') then
    v_fail := v_fail || 'T4 the same statement and period got a second link' || E'\n';
  end if;
  begin
    perform public.send_statement_email(null, 'ZZ Nobody', v_today - 30, v_today, array['x@example.com'], null, false);
    v_fail := v_fail || 'T4 a statement for a client with no invoices was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_statement_email(v_s1, null, v_today, v_today - 5, array['x@example.com'], null, false);
    v_fail := v_fail || 'T4 a statement with its dates the wrong way round was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_statement_email(v_s1, 'Both', v_today - 5, v_today, array['x@example.com'], null, false);
    v_fail := v_fail || 'T4 a statement for a place and a name was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  v_r2 := public.send_statement_email(null, '  zz walk-in ', v_today - 30, v_today, array['walk@example.com'], null, false);
  if (v_r2 ->> 'queued')::int <> 1 then
    v_fail := v_fail || 'T4 the statement for a client by name was not queued' || E'\n';
  end if;

  ---------------------------------------------------------------- T5 a reminder
  v_j := public.client_overdue_invoices(v_s1, null);
  if jsonb_array_length(v_j) <> 1 or v_j -> 0 ->> 'number' <> 'ZZ-T-1' or (v_j -> 0 ->> 'outstanding')::numeric <> 600
     or (v_j -> 0 ->> 'days_overdue')::int <> 40 then
    v_fail := v_fail || format('T5 overdue invoices are wrong: %s', v_j::text) || E'\n';
  end if;
  v_r := public.send_payment_reminder(v_s1, null, array['owes@example.com'], 'firm', 'Please pay.', false);
  if (v_r ->> 'queued')::int <> 1 or (v_r ->> 'invoices')::int <> 1 then
    v_fail := v_fail || format('T5 the reminder answer is wrong: %s', v_r::text) || E'\n';
  end if;
  reset role;
  if not exists (select 1 from public.message_outbox o where o.template = 'payment_reminder' and o.to_address = 'owes@example.com'
                  and o.payload ->> 'tone' = 'firm' and o.payload ->> 'message' = 'Please pay.'
                  and (o.payload ->> 'total_overdue')::numeric = 600 and jsonb_array_length(o.payload -> 'invoices') = 1) then
    v_fail := v_fail || 'T5 the reminder payload is wrong' || E'\n';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.send_payment_reminder(null, 'ZZ Walk-in', array['x@example.com'], 'friendly', 'Hello', false);
    v_fail := v_fail || 'T5 a reminder to a client with nothing overdue was sent' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_payment_reminder(v_s1, null, array['x@example.com'], 'rude', 'Hello', false);
    v_fail := v_fail || 'T5 an unknown tone was accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.send_payment_reminder(v_s1, null, array['x@example.com'], 'friendly', '   ', false);
    v_fail := v_fail || 'T5 an empty message was accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;

  ---------------------------------------------------------------- T7 what was sent (as the admin)
  v_j := public.document_sends_for('invoice', v_i1);
  if jsonb_array_length(v_j) < 3 or not exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'to' = 'client@example.com' and e ->> 'status' = 'queued') then
    v_fail := v_fail || format('T7 the sends for one invoice are wrong: %s', left(v_j::text, 300)) || E'\n';
  end if;
  v_j := public.document_send_summary('statement');
  if not exists (select 1 from jsonb_array_elements(v_j) e where e ->> 'store_id' = v_s1::text and (e ->> 'sends')::int = 2) then
    v_fail := v_fail || format('T7 the statement summary is wrong: %s', left(v_j::text, 300)) || E'\n';
  end if;
  v_j := public.document_send_summary('reminder');
  if jsonb_array_length(v_j) <> 1 or (v_j -> 0 ->> 'sends')::int <> 1 then
    v_fail := v_fail || 'T7 the reminder summary is wrong' || E'\n';
  end if;
  begin
    perform public.document_sends_for('letter');
    v_fail := v_fail || 'T7 an unknown kind was accepted' || E'\n';
  exception when sqlstate '22023' then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- T6 the client's page (service role)
  set local role service_role;
  v_j := public.document_link_view(v_link);
  if v_j ->> 'kind' <> 'invoice' or v_j -> 'invoice' ->> 'invoice_number' <> 'ZZ-T-1'
     or (v_j ->> 'outstanding')::numeric <> 600 or (v_j ->> 'paid')::numeric <> 300 or (v_j ->> 'credited')::numeric <> 100
     or jsonb_array_length(v_j -> 'payments') <> 1 or jsonb_array_length(v_j -> 'credit_notes') <> 1
     or v_j -> 'company' ->> 'name' is null or v_j -> 'look' ->> 'style' <> 'classic' or v_j -> 'look' ->> 'primary' !~ '^#[0-9A-Fa-f]{6}$'
     or v_j ? 'created_by' or v_j -> 'invoice' ? 'created_by' then
    v_fail := v_fail || format('T6 the invoice page data is wrong: %s', left(v_j::text, 400)) || E'\n';
  end if;
  perform public.document_link_opened(v_link);
  perform public.document_link_opened(v_link);
  reset role;
  if (select open_count from public.document_links where id = v_link) <> 2 or (select opened_at from public.document_links where id = v_link) is null then
    v_fail := v_fail || 'T6 openings were not counted' || E'\n';
  end if;
  select l.id into v_link from public.document_links l where l.kind = 'quote' and l.quote_id = v_q1;
  set local role service_role;
  v_j := public.document_link_view(v_link);
  if v_j ->> 'kind' <> 'quote' or v_j -> 'quote' ->> 'quote_number' <> 'ZZ-TQ-1' or jsonb_array_length(v_j -> 'lines') <> 2
     or (v_j ->> 'total')::numeric <> v_qt then
    v_fail := v_fail || format('T6 the quote page data is wrong (want total %s): %s', v_qt, left(v_j::text, 300)) || E'\n';
  end if;
  reset role;
  select l.id into v_link from public.document_links l where l.kind = 'statement' and l.store_id = v_s1;
  set local role service_role;
  v_j := public.document_link_view(v_link);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), (array_agg(x.balance order by x.ordinality desc))[1]
    into v_n, v_t from public.client_statement(v_s1, null, v_today - 90, v_today) with ordinality as x;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if v_j ->> 'kind' <> 'statement' or jsonb_array_length(v_j -> 'statement' -> 'rows') <> v_n
     or (v_j -> 'statement' -> 'rows' -> (v_n - 1) ->> 'balance')::numeric <> v_t
     or (v_j -> 'statement' -> 'ageing' ->> 'total')::numeric <> 600 then
    v_fail := v_fail || format('T6 the statement page does not match client_statement (%s rows, closing %s): %s', v_n, v_t, left(v_j::text, 300)) || E'\n';
  end if;
  -- A voided invoice, an expired link and a withdrawn one show nothing.
  insert into public.document_links (org_id, kind, invoice_id) values (c_gf, 'invoice', v_ivoid) returning id into v_link;
  set local role service_role;
  if public.document_link_view(v_link) is not null then
    v_fail := v_fail || 'T6 a voided invoice''s link still opens' || E'\n';
  end if;
  reset role;
  insert into public.document_links (org_id, kind, invoice_id, expires_at) values (c_gf, 'invoice', v_i2, now() - interval '1 day') returning id into v_link;
  set local role service_role;
  if public.document_link_view(v_link) is not null then
    v_fail := v_fail || 'T6 an expired link still opens' || E'\n';
  end if;
  reset role;
  insert into public.document_links (org_id, kind, invoice_id, revoked_at) values (c_gf, 'invoice', v_i2, now()) returning id into v_link;
  set local role service_role;
  if public.document_link_view(v_link) is not null then
    v_fail := v_fail || 'T6 a withdrawn link still opens' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- T8 who may
  if v_staff is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.send_invoice_email(v_i1, array['x@example.com'], null, false);
      v_fail := v_fail || 'T8 an employee without invoicing sent an invoice' || E'\n';
    exception when others then null;
    end;
    begin
      perform public.document_send_summary('invoice');
      v_fail := v_fail || 'T8 an employee without invoicing read the sends' || E'\n';
    exception when others then null;
    end;
    v_ok := false;
    begin
      select count(*) into v_n from public.document_links;
      v_ok := v_n = 0;
    exception when others then v_ok := true;
    end;
    if not v_ok then
      v_fail := v_fail || 'T8 an employee without invoicing can read the links' || E'\n';
    end if;
    reset role;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.document_link_view(v_link);
    v_fail := v_fail || 'T8 a signed-in person can run the page function' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.document_link_opened(v_link);
    v_fail := v_fail || 'T8 a signed-in person can count an opening' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'invoicing';
  set local role authenticated;
  begin
    perform public.send_invoice_email(v_i1, array['x@example.com'], null, false);
    v_fail := v_fail || 'T8 an invoice was sent with the module off' || E'\n';
  exception when others then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ---------------------------------------------------------------- T9 grants
  if has_function_privilege('anon', 'public.send_invoice_email(uuid, text[], text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.document_link_view(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.document_link_view(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.document_link_opened(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.document_recipients(text[], boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.queue_document_email(uuid, text, text, text, jsonb, text, uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.statement_rows(uuid, uuid, text, date, date)', 'execute')
     or not has_function_privilege('service_role', 'public.document_link_view(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.send_payment_reminder(uuid, text, text[], text, text, boolean)', 'execute')
     or has_table_privilege('authenticated', 'public.document_links', 'insert')
     or has_table_privilege('authenticated', 'public.document_sends', 'update')
     or has_table_privilege('anon', 'public.document_links', 'select') then
    v_fail := v_fail || 'T9 a grant is wrong' || E'\n';
  end if;
  if (select count(*) from public.module_assignments
       where (kind = 'table' and name in ('document_links', 'document_sends'))
          or (kind = 'function' and name in ('client_overdue_invoices', 'send_invoice_email', 'send_quote_email',
                                             'send_statement_email', 'send_payment_reminder', 'document_sends_for',
                                             'document_send_summary'))) <> 9 then
    v_fail := v_fail || 'T9 module registration is wrong' || E'\n';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'site_contacts'
                  and column_name = 'receives_accounts' and column_default = 'false') then
    v_fail := v_fail || 'T9 site_contacts.receives_accounts is missing' || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'SEND DOCUMENT FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL SEND DOCUMENT CHECKS PASSED (rolled back)';
end;
$$;
