-- Damaged stock suite (20261015300000).
--
--   D1  A rep reports damaged stock at a store of their company, against their
--       own visit there, and reads it back; cannot report as somebody else,
--       against another rep's visit or their own visit at another store, read
--       another rep's report, or mark one sorted.
--   D2  A manager reads every report, marks one sorted (who and when are
--       stamped by the database, whatever the page sends) and opens it again
--       (both cleared). Only the status can change: the report itself cannot.
--   D3  What was damaged must be said (a product or an item), and how many is
--       at least one.
--   D4  With distribution off, nothing reads and nothing writes.
--   D5  anon has no access; the stamping function cannot be called directly.
--   D6  Photos (`damage-photos`): a rep uploads into their own folder only,
--       and a report may only name a photo in that folder; the manager reads
--       it; nothing goes into `photos`, which counts visit proof.
--   D7  A product named in a report cannot be deleted (it is deactivated).
--
-- HOW TO RUN: one DO block that always ends in `raise exception`, so nothing
-- survives. The last line of the message is the verdict.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  v_fail text := '';
  v_mgr uuid; v_rep uuid; v_other uuid;
  v_store uuid; v_store2 uuid; v_prod uuid; v_spare uuid;
  v_visit uuid; v_visit_theirs uuid; v_visit_elsewhere uuid;
  v_mine uuid; v_theirs uuid;
  v_n int; r record;
begin
  select id into v_mgr from public.profiles
   where org_id = c_gf and role = 'manager' and is_active order by created_at limit 1;
  select id into v_rep from public.profiles
   where org_id = c_gf and role = 'rep' and is_active order by created_at limit 1;
  select id into v_other from public.profiles
   where org_id = c_gf and role = 'rep' and is_active and id <> v_rep order by created_at limit 1;
  if v_mgr is null or v_rep is null or v_other is null then
    raise exception 'Fixtures missing: a Gold Fortune manager and two reps are needed.';
  end if;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ damage store') returning id into v_store;
  insert into public.stores (org_id, name) values (c_gf, 'ZZ damage store 2') returning id into v_store2;
  select id into v_prod from public.products where org_id = c_gf and active order by name limit 1;
  -- A product with no history at all, so only a damage report can hold it.
  insert into public.products (org_id, name) values (c_gf, 'ZZ damage product') returning id into v_spare;
  -- The rep's visit here, another rep's visit here, and the rep's visit elsewhere.
  insert into public.visits (org_id, rep_id, store_id, client_generated_id)
  values (c_gf, v_rep, v_store, gen_random_uuid()) returning id into v_visit;
  insert into public.visits (org_id, rep_id, store_id, client_generated_id)
  values (c_gf, v_other, v_store, gen_random_uuid()) returning id into v_visit_theirs;
  insert into public.visits (org_id, rep_id, store_id, client_generated_id)
  values (c_gf, v_rep, v_store2, gen_random_uuid()) returning id into v_visit_elsewhere;

  -- Another rep's report, written as the owner, for the rep not to see.
  insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, item, qty, problem)
  values (c_gf, v_store, v_other, gen_random_uuid(), 'Display stand', 1, 'Snapped')
  returning id into v_theirs;

  ---------------------------------------------------------------- D1 the rep
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    -- Against the rep's own visit at this store, as the phone files it.
    insert into public.damage_reports (org_id, store_id, rep_id, visit_id, visit_client_generated_id,
                                       client_generated_id, product_id, qty, problem)
    values (c_gf, v_store, v_rep, v_visit, gen_random_uuid(), gen_random_uuid(), v_prod, 3, 'Crushed in the box')
    returning id into v_mine;
  exception when others then
    v_fail := v_fail || 'D1 a rep could not report damaged stock: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, item, qty)
    values (c_gf, v_store, v_other, gen_random_uuid(), 'Something', 1);
    v_fail := v_fail || 'D1 a rep reported as somebody else' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    -- Somebody else's visit at this store: not the rep's to file against.
    insert into public.damage_reports (org_id, store_id, rep_id, visit_id, client_generated_id, item, qty)
    values (c_gf, v_store, v_rep, v_visit_theirs, gen_random_uuid(), 'Something', 1);
    v_fail := v_fail || 'D1 a rep filed a report against somebody else''s visit' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    -- The rep's own visit, but at another store.
    insert into public.damage_reports (org_id, store_id, rep_id, visit_id, client_generated_id, item, qty)
    values (c_gf, v_store, v_rep, v_visit_elsewhere, gen_random_uuid(), 'Something', 1);
    v_fail := v_fail || 'D1 a rep filed a report against a visit at another store' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, item, qty)
    values (c_gf, v_store, v_rep, gen_random_uuid(), 'Something', 1);
    -- status is not even granted: the default is the only way in.
  exception when others then
    v_fail := v_fail || 'D1 a second report by the same rep was refused: ' || sqlerrm || E'\n';
  end;
  select count(*) into v_n from public.damage_reports where store_id = v_store;
  if v_n <> 2 then
    v_fail := v_fail || format('D1 the rep sees %s reports at the store, expected their own 2', v_n) || E'\n';
  end if;
  begin
    update public.damage_reports set status = 'sorted' where id = v_mine;
    get diagnostics v_n = row_count;
    if v_n <> 0 then v_fail := v_fail || 'D1 a rep marked a report sorted' || E'\n'; end if;
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------- D2 the manager
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.damage_reports where store_id = v_store;
  if v_n <> 3 then
    v_fail := v_fail || format('D2 the manager sees %s reports at the store, expected 3', v_n) || E'\n';
  end if;
  update public.damage_reports set status = 'sorted' where id = v_theirs;
  select * into r from public.damage_reports where id = v_theirs;
  if r.status <> 'sorted' or r.sorted_by is distinct from v_mgr or r.sorted_at is null then
    v_fail := v_fail || format('D2 marking sorted did not stamp who and when: %s', row_to_json(r)) || E'\n';
  end if;
  update public.damage_reports set status = 'open' where id = v_theirs;
  select * into r from public.damage_reports where id = v_theirs;
  if r.status <> 'open' or r.sorted_by is not null or r.sorted_at is not null then
    v_fail := v_fail || format('D2 opening again did not clear the stamp: %s', row_to_json(r)) || E'\n';
  end if;
  begin
    update public.damage_reports set qty = 99 where id = v_theirs;
    v_fail := v_fail || 'D2 a manager changed what was reported' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  ---------------------------------------------------------------- D3 what and how many
  begin
    insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, qty)
    values (c_gf, v_store, v_rep, gen_random_uuid(), 1);
    v_fail := v_fail || 'D3 a report with no product and no item was kept' || E'\n';
  exception when check_violation then null;
  end;
  begin
    insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, item, qty)
    values (c_gf, v_store, v_rep, gen_random_uuid(), 'Something', 0);
    v_fail := v_fail || 'D3 a report of none was kept' || E'\n';
  exception when check_violation then null;
  end;

  ---------------------------------------------------------------- D7 products
  insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, product_id, qty)
  values (c_gf, v_store, v_rep, gen_random_uuid(), v_spare, 1);
  begin
    delete from public.products where id = v_spare;
    v_fail := v_fail || 'D7 a product with a damage report was deleted' || E'\n';
  exception when foreign_key_violation then null;
  end;

  ---------------------------------------------------------------- D6 photos
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('damage-photos', format('%s/%s/%s.jpg', c_gf, v_rep, gen_random_uuid()), v_rep);
  exception when others then
    v_fail := v_fail || 'D6 a rep could not upload a damage photo into their own folder: ' || sqlerrm || E'\n';
  end;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('damage-photos', format('%s/%s/%s.jpg', c_gf, v_other, gen_random_uuid()), v_rep);
    v_fail := v_fail || 'D6 a rep uploaded into somebody else''s folder' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, item, qty, photo_path)
    values (c_gf, v_store, v_rep, gen_random_uuid(), 'Something', 1,
            format('%s/%s/%s.jpg', c_gf, v_other, gen_random_uuid()));
    v_fail := v_fail || 'D6 a report named a photo in somebody else''s folder' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from storage.objects
   where bucket_id = 'damage-photos' and (storage.foldername(name))[2] = v_rep::text;
  if v_n < 1 then
    v_fail := v_fail || 'D6 the manager cannot see the rep''s damage photo' || E'\n';
  end if;
  reset role;

  ---------------------------------------------------------------- D5 grants
  if has_table_privilege('anon', 'public.damage_reports', 'select') then
    v_fail := v_fail || 'D5 anon can read damage_reports' || E'\n';
  end if;
  if has_function_privilege('authenticated', 'public.damage_reports_stamp()', 'execute') then
    v_fail := v_fail || 'D5 the stamping function can be called directly' || E'\n';
  end if;
  if (select module_code from public.module_assignments where kind = 'bucket' and name = 'damage-photos')
       is distinct from 'distribution' then
    v_fail := v_fail || 'D5 the damage-photos bucket is not registered to distribution' || E'\n';
  end if;
  if (select module_code from public.module_assignments where kind = 'table' and name = 'damage_reports')
       is distinct from 'distribution' then
    v_fail := v_fail || 'D5 damage_reports is not registered to distribution' || E'\n';
  end if;

  ---------------------------------------------------------------- D4 distribution off
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'warehouse';
  update public.company_modules set enabled = false where org_id = c_gf and module_code = 'distribution';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mgr, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.damage_reports where store_id = v_store;
  if v_n <> 0 then
    v_fail := v_fail || format('D4 %s reports read with distribution off', v_n) || E'\n';
  end if;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.damage_reports (org_id, store_id, rep_id, client_generated_id, item, qty)
    values (c_gf, v_store, v_rep, gen_random_uuid(), 'Something', 1);
    v_fail := v_fail || 'D4 a report was written with distribution off' || E'\n';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise exception '%', case when v_fail = ''
    then 'DAMAGED STOCK SUITE PASSED'
    else E'DAMAGED STOCK SUITE FAILED\n' || v_fail end;
end;
$$;
