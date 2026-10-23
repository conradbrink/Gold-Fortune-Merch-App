-- An edited quote saved in one step: quote_save (23 Oct 2026).
--
--   Q1  A draft's header and lines are saved as given: a changed line keeps
--       its id, a new line is written under the id given, a line left out
--       goes, a product put back under a new id is one line, positions run
--       1..N, units are trimmed, and the client may change.
--   Q2  A form loaded before somebody else's save (another updated_at) is
--       refused with the hint 'stale', and nothing changes.
--   Q3  No lines is refused, and nothing changes.
--   Q4  A draft with no client is refused by quotes_has_client, and nothing
--       changes: the header is not kept when the save fails.
--   Q5  The same product twice is refused, and nothing changes.
--   Q6  A line the database refuses (a unit over 20 characters) after a good
--       header: nothing changes, the header included.
--   Q7  A sent quote keeps its client; its other details still change.
--   Q8  An accepted quote is refused with the words the screen shows.
--   Q9  An active user of another company cannot touch it.
--   Q10 security invoker, a fixed search_path, no execute for anon or PUBLIC.
--   Q11 A line that stays keeps when it was added; a new line is added now.
--   Q12 A converted quote is refused with the words the screen shows.
--
-- Every call that should fail runs in its own block, as PostgREST runs each
-- call in its own transaction, so whatever it did before failing is undone
-- and the check that "nothing changes" sees what a client would see.
--
-- Note: within one transaction now() does not move, so quotes_stamp gives
-- every update here the same updated_at. Q2 passes an earlier time instead.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_checks int := 0;
  v_mgr uuid; v_foreign uuid; v_product uuid; v_product2 uuid;
  v_q uuid; v_at timestamptz;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid();
  v_new uuid := gen_random_uuid();
  v_snap text; v_err text; v_hint text; v_n int; r record;
  c_good_line jsonb;
begin
  select p.id into v_mgr from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role in ('admin', 'manager')
   order by p.role, p.created_at, p.id limit 1;
  select id into v_product from public.products where org_id = c_gf and active order by name, id limit 1;
  select id into v_product2 from public.products where org_id = c_gf and active and id <> v_product order by name, id limit 1;
  select p.id into v_foreign from public.profiles p
   where p.org_id <> c_gf and p.is_active
     and not exists (select 1 from public.company_account ca where ca.org_id = p.org_id and ca.closed_at is not null)
   order by p.created_at, p.id limit 1;
  if v_mgr is null or v_product is null or v_product2 is null or v_foreign is null then
    raise exception 'Fixtures missing: manager %, products % %, foreign user %', v_mgr, v_product, v_product2, v_foreign;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.has_permission('invoicing') then
    raise exception 'Fixture: % cannot work quotes', v_mgr;
  end if;
  insert into public.quotes (org_id, quote_number, customer_name, notes)
  values (c_gf, 'QZ-' || left(md5(random()::text), 8), 'Suite client', 'before')
  returning id, updated_at into v_q, v_at;
  insert into public.quote_lines (id, org_id, quote_id, position, description, unit, qty, list_price) values
    (v_a, c_gf, v_q, 1, 'Deep clean', '845.50', 1, 845.50),
    (v_b, c_gf, v_q, 2, 'Windows', null, 1, 100);
  insert into public.quote_lines (id, org_id, quote_id, position, product_id, qty, list_price)
  values (v_p, c_gf, v_q, 3, v_product, 2, 50);
  c_good_line := jsonb_build_object('id', v_a, 'description', 'Deep clean', 'unit', 'bag', 'qty', 1, 'list_price', 845.50);

  ---------------------------------------------------------------- Q1 saved as given
  perform public.quote_save(v_q, v_at,
    jsonb_build_object('customer_name', 'New client', 'customer_address', '1 Main Road', 'notes', 'after', 'valid_until', '2026-12-31'),
    jsonb_build_array(
      jsonb_build_object('id', v_a, 'description', 'Deep clean', 'unit', ' bag ', 'qty', 1, 'list_price', 845.50),
      jsonb_build_object('id', v_new, 'description', 'Carpets', 'unit', null, 'qty', 1.5, 'list_price', 300),
      jsonb_build_object('id', gen_random_uuid(), 'product_id', v_product, 'qty', 3, 'list_price', 50, 'discount_amount', 10)
    ));
  v_checks := v_checks + 1;
  select string_agg(format('%s:%s:%s:%s', position, coalesce(description, 'product'), coalesce(unit, '-'), qty::text), ', ' order by position)
    into v_err from public.quote_lines where quote_id = v_q;
  if v_err is distinct from '1:Deep clean:bag:1.00, 2:Carpets:-:1.50, 3:product:-:3.00' then
    v_fail := v_fail || 'Q1 lines are ' || coalesce(v_err, 'none') || E'\n';
  end if;
  if not exists (select 1 from public.quote_lines where id = v_a and quote_id = v_q)
     or not exists (select 1 from public.quote_lines where id = v_new and quote_id = v_q)
     or exists (select 1 from public.quote_lines where id in (v_b, v_p)) then
    v_fail := v_fail || 'Q1 a saved line lost its id, a new line is not under its own, or a line left out stayed' || E'\n';
  end if;
  if (select discount_amount from public.quote_lines where quote_id = v_q and product_id = v_product) <> 10 then
    v_fail := v_fail || 'Q1 the product''s amount off the line was not kept' || E'\n';
  end if;
  select customer_name, customer_address, notes, valid_until into r from public.quotes where id = v_q;
  if r.customer_name <> 'New client' or r.customer_address <> '1 Main Road' or r.notes <> 'after' or r.valid_until <> date '2026-12-31' then
    v_fail := v_fail || format('Q1 header is %s / %s / %s / %s', r.customer_name, r.customer_address, r.notes, r.valid_until) || E'\n';
  end if;

  ---------------------------------------------------------------- refusals change nothing
  -- Q2 stale
  select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) || md5((select q::text from public.quotes q where q.id = v_q))
    into v_snap from public.quote_lines l where l.quote_id = v_q;
  begin
    perform public.quote_save(v_q, v_at - interval '1 second', jsonb_build_object('customer_name', 'New client', 'notes', 'stale'), jsonb_build_array(c_good_line));
    v_fail := v_fail || 'Q2 a stale form was not refused' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text, v_hint = pg_exception_hint;
    if v_hint is distinct from 'stale' then v_fail := v_fail || 'Q2 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;

  -- Q3 no lines
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('customer_name', 'New client', 'notes', 'none'), '[]'::jsonb);
    v_fail := v_fail || 'Q3 a quote with no lines was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'Add at least one line%' then v_fail := v_fail || 'Q3 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;

  -- Q4 no client on a draft
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('notes', 'no client'), jsonb_build_array(c_good_line));
    v_fail := v_fail || 'Q4 a draft with no client was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%quotes_has_client%' then v_fail := v_fail || 'Q4 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;

  -- Q5 the same product twice
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('customer_name', 'New client', 'notes', 'twice'), jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'product_id', v_product2, 'qty', 1, 'list_price', 10),
      jsonb_build_object('id', gen_random_uuid(), 'product_id', v_product2, 'qty', 2, 'list_price', 10)));
    v_fail := v_fail || 'Q5 the same product twice was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%quote_lines_quote_product_key%' then v_fail := v_fail || 'Q5 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;

  -- Q6 a bad line after a good header
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('customer_name', 'New client', 'notes', 'atomic'), jsonb_build_array(
      c_good_line,
      jsonb_build_object('id', gen_random_uuid(), 'description', 'Too long a unit', 'unit', repeat('x', 25), 'qty', 1, 'list_price', 1)));
    v_fail := v_fail || 'Q6 a unit over 20 characters was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like '%quote_lines_unit_len%' then v_fail := v_fail || 'Q6 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;

  if v_snap is distinct from (select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) || md5((select q::text from public.quotes q where q.id = v_q))
                                 from public.quote_lines l where l.quote_id = v_q) then
    v_fail := v_fail || 'Q2-Q6 a refused save changed the quote' || E'\n';
  end if;

  ---------------------------------------------------------------- Q7 a sent quote keeps its client
  update public.quotes set status = 'sent' where id = v_q;
  select updated_at into v_at from public.quotes where id = v_q;
  perform public.quote_save(v_q, v_at,
    jsonb_build_object('customer_name', 'Someone else', 'customer_address', 'Elsewhere', 'contact_email', 'x@y.co', 'notes', 'sent edit'),
    jsonb_build_array(c_good_line));
  v_checks := v_checks + 1;
  select customer_name, customer_address, contact_email, notes into r from public.quotes where id = v_q;
  if r.customer_name <> 'New client' or r.customer_address <> '1 Main Road' or r.contact_email is not null or r.notes <> 'sent edit' then
    v_fail := v_fail || format('Q7 sent quote is now for %s / %s / %s, notes %s', r.customer_name, r.customer_address, r.contact_email, r.notes) || E'\n';
  end if;
  select count(*) into v_n from public.quote_lines where quote_id = v_q;
  if v_n <> 1 then v_fail := v_fail || format('Q7 sent quote has %s lines, expected 1', v_n) || E'\n'; end if;

  ---------------------------------------------------------------- Q8 accepted
  update public.quotes set status = 'accepted' where id = v_q;
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('notes', 'too late'), jsonb_build_array(c_good_line));
    v_fail := v_fail || 'Q8 an accepted quote was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'This quote was accepted.%' then v_fail := v_fail || 'Q8 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;
  update public.quotes set status = 'sent' where id = v_q;

  ---------------------------------------------------------------- Q9 another company
  select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) || md5((select q::text from public.quotes q where q.id = v_q))
    into v_snap from public.quote_lines l where l.quote_id = v_q;
  perform set_config('request.jwt.claims', json_build_object('sub', v_foreign, 'role', 'authenticated')::text, true);
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('notes', 'foreign'), jsonb_build_array(c_good_line));
    v_fail := v_fail || 'Q9 another company saved the quote' || E'\n';
  exception when others then
    null; -- refused: by the module gate if that company has no invoicing, else as not found
  end;
  v_checks := v_checks + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  if v_snap is distinct from (select md5(coalesce(string_agg(l::text, '|' order by l.id), '')) || md5((select q::text from public.quotes q where q.id = v_q))
                                 from public.quote_lines l where l.quote_id = v_q) then
    v_fail := v_fail || 'Q9 another company changed the quote' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- Q10 rights
  select p.prosecdef, p.proconfig::text as cfg,
         has_function_privilege('anon', p.oid, 'execute') as anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
         exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_x
    into r
    from pg_proc p where p.oid = 'public.quote_save(uuid, timestamptz, jsonb, jsonb)'::regprocedure;
  v_checks := v_checks + 1;
  if r.prosecdef or r.cfg not like '%search_path%' or r.anon_x or not r.auth_x or r.public_x then
    v_fail := v_fail || format('Q10 definer %s, config %s, anon %s, authenticated %s, public %s', r.prosecdef, r.cfg, r.anon_x, r.auth_x, r.public_x) || E'\n';
  end if;
  if not exists (select 1 from public.module_assignments where kind = 'function' and name = 'quote_save' and module_code = 'invoicing') then
    v_fail := v_fail || 'Q10 quote_save has no module' || E'\n';
  end if;

  ---------------------------------------------------------------- Q11 when a line was added
  update public.quote_lines set created_at = timestamptz '2026-01-01 08:00+00' where id = v_a;
  update public.quotes set status = 'draft' where id = v_q;
  perform set_config('request.jwt.claims', json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select updated_at into v_at from public.quotes where id = v_q;
  perform public.quote_save(v_q, v_at, jsonb_build_object('customer_name', 'New client'), jsonb_build_array(
    c_good_line, jsonb_build_object('id', v_b, 'description', 'Windows', 'qty', 1, 'list_price', 100)));
  v_checks := v_checks + 1;
  if (select created_at from public.quote_lines where id = v_a) <> timestamptz '2026-01-01 08:00+00'
     or (select created_at from public.quote_lines where id = v_b) <> now() then
    v_fail := v_fail || 'Q11 a line that stayed lost when it was added, or a new line was not added now' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- Q12 converted
  update public.quotes
     set status = 'converted',
         converted_order_id = (select o.id from public.orders o
                                where o.org_id = c_gf
                                  and not exists (select 1 from public.quotes x where x.converted_order_id = o.id)
                                order by o.created_at desc limit 1)
   where id = v_q;
  set local role authenticated;
  begin
    perform public.quote_save(v_q, v_at, jsonb_build_object('notes', 'an order now'), jsonb_build_array(c_good_line));
    v_fail := v_fail || 'Q12 a converted quote was saved' || E'\n';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err not like 'This quote is already an order.%' then v_fail := v_fail || 'Q12 refused for another reason: ' || v_err || E'\n'; end if;
  end;
  v_checks := v_checks + 1;
  reset role;

  if v_fail = '' then
    raise exception 'quote_save: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'quote_save: FAIL\n%', v_fail;
end;
$$;
