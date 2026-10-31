-- A rep adds a new customer from the phone: 20261029161300_store_add_from_phone,
-- with the suburb and area from 20261031154700_store_add_from_phone_suburb.
--
--   A1  A rep adds a customer: name tidied, delivery address, town, the
--       position they stand at (source 'rep'), the price group they chose.
--   A2  The same call again (a retry after a lost reply) answers with the
--       customer already there and adds nobody.
--   A3  Refused, adding nothing: no name, no delivery address, half a
--       position, a price group from another company.
--   A4  A rep still cannot insert into stores directly.
--   A5  An id that belongs to another company's customer is refused.
--   A6  The rep can take an order for the customer they just added.
--   A7  store_add_from_phone keeps its security: definer, a fixed
--       search_path, no execute for anon or PUBLIC.
--   A8  A suburb the company has: the company's spelling, and the area most
--       of its customers with an area are in. Customers with no area, and
--       another company's, do not count.
--   A9  A town with a suburb in it: the suburb, and the words left over on
--       the end of the address (once, and not when the address has them).
--   A10 The longest suburb wins; a town that matches nothing is kept as
--       typed with no area.
--
-- HOW TO RUN: as dashboard.sql. One DO block that always ends in
-- `raise exception`, so nothing survives.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_checks int := 0;
  v_rep uuid; v_group uuid; v_other_group uuid; v_other_store uuid;
  v_t1 uuid; v_t2 uuid; v_other_terr uuid; v_other_org uuid;
  v_id uuid := gen_random_uuid();
  v_stores int; v_err text; v_res jsonb; r record; v_row public.stores;
  v_name text := 'ZZ Phone Customer ' || left(md5(random()::text), 6);
begin
  select p.id into v_rep from public.profiles p
   where p.org_id = c_gf and p.is_active and p.role = 'rep'
   order by p.created_at, p.id limit 1;
  select id into v_group from public.store_groups where org_id = c_gf order by name, id limit 1;
  select id into v_other_group from public.store_groups where org_id <> c_gf order by id limit 1;
  select id into v_other_store from public.stores where org_id <> c_gf order by id limit 1;
  select id into v_t1 from public.territories
   where org_id = c_gf and level = 'territory' and active order by id limit 1;
  select id into v_t2 from public.territories
   where org_id = c_gf and level = 'territory' and active and id <> v_t1 order by id limit 1;
  select id, org_id into v_other_terr, v_other_org from public.territories
   where org_id <> c_gf and level = 'territory' and active order by id limit 1;
  if v_rep is null or v_t2 is null then
    raise exception 'Fixtures missing: a rep and two areas in the company';
  end if;

  -- Suburbs no company has (Zzq): Mitchells Plain mostly in the first area,
  -- with a second spelling in the second; customers with no area that would
  -- outvote both; Table View, Park and Park East in the second area; and
  -- another company's suburb.
  insert into public.stores (org_id, name, city, territory_id, geofence_radius_m)
  select c_gf, 'ZZ Suburb fixture', t.city, t.territory_id, 100
    from (values
      ('Zzq Mitchells Plain', v_t1), ('Zzq Mitchells Plain', v_t1), ('Zzq Mitchells Plain', v_t1),
      ('Zzq Mitchells Plain', v_t2), ('ZZQ MITCHELLS PLAIN', v_t2),
      ('zzq mitchells plain', null), ('zzq mitchells plain', null), ('zzq mitchells plain', null),
      ('zzq mitchells plain', null), ('zzq mitchells plain', null),
      ('Zzq Table View', v_t2), ('Zzq Park', v_t1), ('Zzq Park East', v_t2)
    ) t(city, territory_id);
  if v_other_terr is not null then
    insert into public.stores (org_id, name, city, territory_id, geofence_radius_m)
    values (v_other_org, 'ZZ Suburb fixture', 'Zzq Elsewhere', v_other_terr, 100);
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ---------------------------------------------------------------- A1 a rep adds
  select count(*) into v_stores from public.stores where org_id = c_gf;
  v_res := public.store_add_from_phone(
    v_id, '  ' || replace(v_name, ' ', '   ') || ' ', ' 12 Main Road ', ' Mahikeng ',
    -25.85, 25.64, 12, v_group);
  v_checks := v_checks + 1;
  select * into r from public.stores where id = v_id;
  if r.id is null
     or (r.org_id, r.name, r.address, r.city, r.lat, r.lng, r.geocode_source, r.geocode_accuracy_m, r.active)
        is distinct from (c_gf, v_name, '12 Main Road', 'Mahikeng', -25.85::float8, 25.64::float8, 'rep', 12::float8, true)
     or r.store_group_id is distinct from v_group
     or (v_res->>'already_added')::boolean then
    v_fail := v_fail || 'A1 the customer is ' || coalesce(row_to_json(r)::text, 'missing') || ' / ' || v_res::text || E'\n';
  end if;

  ---------------------------------------------------------------- A2 replay
  v_res := public.store_add_from_phone(v_id, 'Another name', 'Elsewhere');
  v_checks := v_checks + 1;
  if not (v_res->>'already_added')::boolean
     or (select count(*) from public.stores where org_id = c_gf) <> v_stores + 1
     or (select name from public.stores where id = v_id) is distinct from v_name then
    v_fail := v_fail || 'A2 the retry was not answered with the customer already there: ' || v_res::text || E'\n';
  end if;

  ---------------------------------------------------------------- A3 refusals
  select count(*) into v_stores from public.stores where org_id = c_gf;
  for r in
    select * from (values
      ('no name', '   ', '1 Road', null::float8, null::float8, null::uuid, 'What is the shop called?'),
      ('no address', 'ZZ Name', '  ', null, null, null, 'Where do we deliver?%'),
      ('half a position', 'ZZ Name', '1 Road', -25.8::float8, null, null, 'That position is not a place on the map.'),
      ('foreign group', 'ZZ Name', '1 Road', null, null, v_other_group, 'That price group is not one of your company''s.')
    ) t(label, nm, addr, lat, lng, grp, expect)
  loop
    continue when r.label = 'foreign group' and v_other_group is null;
    v_checks := v_checks + 1;
    begin
      perform public.store_add_from_phone(gen_random_uuid(), r.nm, r.addr, null, r.lat, r.lng, null, r.grp);
      v_fail := v_fail || 'A3 ' || r.label || ' was accepted' || E'\n';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err not like r.expect then
        v_fail := v_fail || 'A3 ' || r.label || ' refused for another reason: ' || v_err || E'\n';
      end if;
    end;
  end loop;
  if (select count(*) from public.stores where org_id = c_gf) <> v_stores then
    v_fail := v_fail || 'A3 a refusal added a customer' || E'\n';
  end if;

  ---------------------------------------------------------------- A4 no direct insert
  v_checks := v_checks + 1;
  begin
    insert into public.stores (org_id, name) values (c_gf, v_name || ' direct');
    v_fail := v_fail || 'A4 a rep inserted into stores directly' || E'\n';
  exception when insufficient_privilege then null;
  end;

  ---------------------------------------------------------------- A5 another company's id
  if v_other_store is not null then
    v_checks := v_checks + 1;
    begin
      perform public.store_add_from_phone(v_other_store, 'ZZ Name', '1 Road');
      v_fail := v_fail || 'A5 another company''s id was answered' || E'\n';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err <> 'That customer cannot be added.' then
        v_fail := v_fail || 'A5 refused for another reason: ' || v_err || E'\n';
      end if;
    end;
  end if;

  ---------------------------------------------------------------- A6 an order for them
  v_checks := v_checks + 1;
  begin
    insert into public.orders (org_id, order_number, store_id, rep_id, source, received_via,
                               client_generated_id, delivery_address, contact_name, contact_phone)
    values (c_gf, 'SO-ZZ' || left(md5(random()::text), 6), v_id, v_rep, 'rep_app', 'rep_visit',
            gen_random_uuid(), '12 Main Road, Mahikeng', 'K. Molefe', '0820000000');
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_fail := v_fail || 'A6 the rep could not order for the new customer: ' || v_err || E'\n';
  end;

  ---------------------------------------------------------------- A8 a suburb the company has
  for r in
    select * from (values
      ('picked', 'Zzq Mitchells Plain', 'Zzq Mitchells Plain', v_t1),
      ('typed in small letters', 'zzq   mitchells plain', 'Zzq Mitchells Plain', v_t1),
      ('typed with an apostrophe', 'ZZQ MITCHELL''S PLAIN', 'Zzq Mitchells Plain', v_t1),
      ('typed as one word', 'ZZQTABLEVIEW', 'Zzq Table View', v_t2),
      ('another company''s', 'Zzq Elsewhere', 'Zzq Elsewhere', null)
    ) t(label, town, city, territory_id)
  loop
    v_id := gen_random_uuid();
    v_checks := v_checks + 1;
    perform public.store_add_from_phone(v_id, v_name || ' ' || r.label, '7 Rose Street', r.town);
    select * into v_row from public.stores where id = v_id;
    if (v_row.city, v_row.territory_id, v_row.address)
       is distinct from (r.city, r.territory_id, '7 Rose Street') then
      v_fail := v_fail || 'A8 ' || r.label || ': ' || coalesce(v_row.city, 'no town') || ' / '
                || coalesce(v_row.territory_id::text, 'no area') || ' / ' || coalesce(v_row.address, '') || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- A9 the part of town goes to the address
  for r in
    select * from (values
      ('after the suburb', 'ZZQ MITCHELL S PLAIN  WESTRIDGE', '12 Main Road', '12 Main Road, Westridge'),
      ('before the suburb', 'new woodlands, zzq mitchells plain', '12 Main Road', '12 Main Road, New Woodlands'),
      ('mixed case kept', 'Zzq Mitchells Plain Lentegeur Ext', '3 Kudu St', '3 Kudu St, Lentegeur Ext'),
      ('in the address already', 'Zzq Mitchells Plain Westridge', '4 Rose St, Westridge', '4 Rose St, Westridge')
    ) t(label, town, addr, expect)
  loop
    v_id := gen_random_uuid();
    v_checks := v_checks + 1;
    perform public.store_add_from_phone(v_id, v_name || ' ' || r.label, r.addr, r.town);
    select * into v_row from public.stores where id = v_id;
    if (v_row.city, v_row.territory_id, v_row.address)
       is distinct from ('Zzq Mitchells Plain', v_t1, r.expect) then
      v_fail := v_fail || 'A9 ' || r.label || ': ' || coalesce(v_row.city, 'no town') || ' / '
                || coalesce(v_row.territory_id::text, 'no area') || ' / ' || coalesce(v_row.address, '') || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- A10 longest wins; unknown kept
  for r in
    select * from (values
      ('longest', 'Zzq Park East', 'Zzq Park East', v_t2),
      ('unknown', 'Zzq Nowhere Heights', 'Zzq Nowhere Heights', null::uuid)
    ) t(label, town, city, territory_id)
  loop
    v_id := gen_random_uuid();
    v_checks := v_checks + 1;
    perform public.store_add_from_phone(v_id, v_name || ' ' || r.label, '1 Road', r.town);
    select * into v_row from public.stores where id = v_id;
    if (v_row.city, v_row.territory_id, v_row.address)
       is distinct from (r.city, r.territory_id, '1 Road') then
      v_fail := v_fail || 'A10 ' || r.label || ': ' || coalesce(v_row.city, 'no town') || ' / '
                || coalesce(v_row.territory_id::text, 'no area') || ' / ' || coalesce(v_row.address, '') || E'\n';
    end if;
  end loop;

  reset role;

  ---------------------------------------------------------------- A7 security
  select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)) as ok
    into r from pg_proc p
   where p.oid = 'public.store_add_from_phone(uuid, text, text, text, double precision, double precision, double precision, uuid)'::regprocedure;
  v_checks := v_checks + 1;
  if not coalesce(r.ok, false) then
    v_fail := v_fail || 'A7 store_add_from_phone lost its security settings' || E'\n';
  end if;

  if v_fail = '' then
    raise exception 'store_add_from_phone: ALL PASS (% checks)', v_checks;
  end if;
  raise exception E'store_add_from_phone: FAIL\n%', v_fail;
end;
$$;
