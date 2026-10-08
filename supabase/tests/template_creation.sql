-- Template creation suite: "creating a company from each template produces a
-- working account" (requirements §6), and creation is all-or-nothing.
--
--   C1  For every active template, and for one combination (cleaning +
--       maintenance), create_company builds a company whose modules, words,
--       settings, checklists and forms are exactly what template_defaults
--       proposed; its field role carries the staff word; it can see none of
--       Gold Fortune's data and Gold Fortune cannot see it.
--   C2  The owner path: a login becomes the new company's Administrator,
--       holds `admin`, and reads the template's words and settings through
--       my_company_config(); a module the template leaves off is refused.
--   C3  A bad choice (an invalid setting) leaves no organisation behind.
--   C4  Only the service role may call create_company / template_defaults.
--
-- HOW TO RUN: paste into execute_sql (or psql -f). One DO block that always
-- ends in `raise exception`, so nothing survives — including the profile it
-- removes and re-creates for C2 (a login with no field data of its own, so
-- nothing that matters is touched even inside the transaction).

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  t record;
  v_def jsonb;
  v_org uuid;
  v_n int; v_m int; v_txt text;
  v_fail text := ''; v_info text := '';
  v_checked int := 0;
  v_owner uuid; v_owner_email text; v_cfg jsonb;
begin
  ------------------------------------------------------------ C1 each template
  for t in
    select array[code] as codes from public.industry_templates where is_active
    union all select array['cleaning', 'maintenance']
  loop
    v_checked := v_checked + 1;
    v_def := public.template_defaults(t.codes);
    v_org := public.create_company(
      jsonb_build_object('name', 'Template check ' || array_to_string(t.codes, '+'),
                         'country_code', 'ZA', 'currency_code', 'ZAR', 'timezone', 'Africa/Johannesburg'),
      t.codes);

    -- Modules: exactly the built ones the templates name.
    select string_agg(x, ', ' order by x) into v_txt from (
      (select m->>'code' x from jsonb_array_elements(v_def->'modules') m where (m->>'built')::boolean
       except select module_code from public.company_modules where org_id = v_org and enabled)
      union all
      (select module_code from public.company_modules where org_id = v_org and enabled
       except select m->>'code' from jsonb_array_elements(v_def->'modules') m where (m->>'built')::boolean)
    ) d;
    if v_txt is not null then
      v_fail := v_fail || format('C1 %s: modules differ from the template (%s)%s', t.codes, v_txt, E'\n');
    end if;

    -- Words and settings: exactly the proposal (country and currency from the details).
    select count(*) into v_n from jsonb_each(v_def->'terms') d
     where not exists (select 1 from public.company_terminology ct
                        where ct.org_id = v_org and ct.key = d.key
                          and ct.singular = d.value->>'one' and ct.plural = d.value->>'many');
    if v_n > 0 then
      v_fail := v_fail || format('C1 %s: %s word(s) differ from the template%s', t.codes, v_n, E'\n');
    end if;
    select count(*) into v_n from jsonb_each(v_def->'settings') d
     where d.key not in ('country_code', 'currency_code')
       and not exists (select 1 from public.company_settings cs
                        where cs.org_id = v_org and cs.key = d.key and cs.value = d.value);
    if v_n > 0 then
      v_fail := v_fail || format('C1 %s: %s setting(s) differ from the template%s', t.codes, v_n, E'\n');
    end if;
    if public.org_setting(v_org, 'country_code') #>> '{}' <> 'ZA'
       or public.org_setting(v_org, 'currency_code') #>> '{}' <> 'ZAR' then
      v_fail := v_fail || format('C1 %s: country or currency not taken from the details%s', t.codes, E'\n');
    end if;

    -- Checklists and forms: one form each, with every item.
    select count(*) into v_n from public.form_templates where org_id = v_org;
    v_m := jsonb_array_length(v_def->'checklists') + jsonb_array_length(v_def->'forms');
    if v_n <> v_m then
      v_fail := v_fail || format('C1 %s: %s forms, expected %s%s', t.codes, v_n, v_m, E'\n');
    end if;
    select count(*) into v_n from public.form_fields ff join public.form_templates ft on ft.id = ff.form_template_id
     where ft.org_id = v_org;
    select coalesce(sum(jsonb_array_length(c->'items')), 0) + coalesce((select sum(jsonb_array_length(f->'fields'))
             from jsonb_array_elements(v_def->'forms') f), 0)
      into v_m from jsonb_array_elements(v_def->'checklists') c;
    if v_n <> v_m then
      v_fail := v_fail || format('C1 %s: %s form fields, expected %s%s', t.codes, v_n, v_m, E'\n');
    end if;

    -- The trades' price list, without prices (Stage 7), when the module is on.
    select count(*) into v_n from public.service_items where org_id = v_org and unit_price is null;
    v_m := case when exists (select 1 from public.company_modules where org_id = v_org
                              and module_code = 'invoicing' and enabled)
                then jsonb_array_length(v_def->'service_items') else 0 end;
    if v_n <> v_m or exists (select 1 from public.service_items where org_id = v_org and unit_price is not null) then
      v_fail := v_fail || format('C1 %s: %s price-list items, expected %s%s', t.codes, v_n, v_m, E'\n');
    end if;

    -- The field role is named in the company's staff word; roles were provisioned.
    if not exists (select 1 from public.job_roles where org_id = v_org and code = 'sales_rep'
                    and name = v_def->'terms'->'staff'->>'one') then
      v_fail := v_fail || format('C1 %s: field role not named %s%s', t.codes, v_def->'terms'->'staff'->>'one', E'\n');
    end if;
    if not exists (select 1 from public.job_roles where org_id = v_org and code = 'administrator') then
      v_fail := v_fail || format('C1 %s: no Administrator role%s', t.codes, E'\n');
    end if;

    -- Records what it was made from.
    if (select industries from public.organizations where id = v_org) is distinct from t.codes then
      v_fail := v_fail || format('C1 %s: industries not recorded%s', t.codes, E'\n');
    end if;
  end loop;

  ------------------------------------------------------------- C2 the owner
  -- A login with no field data of its own and nothing that blocks a delete.
  select p.id, p.email into v_owner, v_owner_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager'
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  if v_owner is null then
    raise exception 'Fixtures missing: no quiet login to use as the owner.';
  end if;
  delete from public.profiles where id = v_owner;

  v_org := public.create_company(
    jsonb_build_object('name', 'Template check owner', 'country_code', 'ZA', 'timezone', 'Africa/Johannesburg',
                       'owner', jsonb_build_object('full_name', 'Owner Check', 'email', v_owner_email)),
    array['installation'], '{}'::jsonb, v_owner, null);

  if not exists (select 1 from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
                  where p.id = v_owner and p.org_id = v_org and p.role = 'manager' and jr.code = 'administrator') then
    v_fail := v_fail || 'C2 the owner is not the new company''s Administrator' || E'\n';
  end if;
  if not exists (select 1 from public.profile_permissions where profile_id = v_owner and permission_code = 'admin') then
    v_fail := v_fail || 'C2 the owner does not hold admin' || E'\n';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_cfg := public.my_company_config();
  if v_cfg->>'org_id' is distinct from v_org::text
     or v_cfg#>>'{terms,job,one}' is distinct from 'Installation'
     or v_cfg#>>'{terms,staff,one}' is distinct from 'Installer'
     or (v_cfg#>>'{settings,checkin_radius_m}')::int is distinct from 150
     or v_cfg#>>'{branding,name}' is distinct from 'Template check owner' then
    v_fail := v_fail || format('C2 my_company_config for the owner is wrong: %s%s', left(v_cfg::text, 300), E'\n');
  end if;
  -- Distribution is not in the Installation template: its tables read empty
  -- and its functions refuse.
  select count(*) into v_n from public.orders;
  if v_n > 0 then v_fail := v_fail || 'C2 the owner can read orders without distribution' || E'\n'; end if;
  begin
    perform public.require_module('distribution');
    v_fail := v_fail || 'C2 the distribution module answers as on' || E'\n';
  exception when others then
    if sqlstate <> '42501' then
      v_fail := v_fail || format('C2 the module gate refused for the wrong reason: %s %s%s', sqlstate, sqlerrm, E'\n');
    end if;
  end;
  -- And it sees nothing of Gold Fortune's.
  select count(*) into v_n from public.stores where org_id = c_gf;
  select v_n + count(*) into v_n from public.profiles where org_id = c_gf;
  if v_n > 0 then v_fail := v_fail || format('C2 the new owner sees %s Gold Fortune rows%s', v_n, E'\n'); end if;
  -- Its own checklists are there.
  select count(*) into v_n from public.form_templates where org_id = v_org;
  if v_n = 0 then v_fail := v_fail || 'C2 the owner sees no checklists' || E'\n'; end if;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ------------------------------------------------- C3 all or nothing
  select count(*) into v_m from public.organizations;
  begin
    perform public.create_company(jsonb_build_object('name', 'Template check broken'),
                                  array['cleaning'], '{"settings": {"gps_ping_interval_minutes": 999}}'::jsonb);
    v_fail := v_fail || 'C3 an invalid setting was accepted' || E'\n';
  exception when others then
    null;
  end;
  select count(*) into v_n from public.organizations;
  if v_n <> v_m or exists (select 1 from public.organizations where name = 'Template check broken') then
    v_fail := v_fail || 'C3 a failed creation left an organisation behind' || E'\n';
  end if;
  begin
    perform public.template_defaults(array['no_such_trade']);
    v_fail := v_fail || 'C3 an unknown template was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  -- A chosen checklist or form the templates do not propose is refused, not skipped.
  begin
    perform public.create_company(jsonb_build_object('name', 'Template check broken'),
                                  array['cleaning'], '{"checklists": ["office_clean", "no_such_checklist"]}'::jsonb);
    v_fail := v_fail || 'C3 an unknown checklist code was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_company(jsonb_build_object('name', 'Template check broken'),
                                  array['plumbing'], '{"forms": ["no_such_form"]}'::jsonb);
    v_fail := v_fail || 'C3 an unknown form code was accepted' || E'\n';
  exception when invalid_parameter_value then null;
  end;
  if exists (select 1 from public.organizations where name = 'Template check broken') then
    v_fail := v_fail || 'C3 a refused checklist or form code left an organisation behind' || E'\n';
  end if;

  ------------------------------------------------- C4 who may call it
  if has_function_privilege('authenticated', 'public.create_company(jsonb, text[], jsonb, uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.create_company(jsonb, text[], jsonb, uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.template_defaults(text[])', 'execute') then
    v_fail := v_fail || 'C4 create_company or template_defaults is callable by a signed-in or anonymous user' || E'\n';
  end if;

  ------------------------------------------------------------------ report
  v_txt := format('%s template sets created and checked; owner path, rollback and grants checked.', v_checked);
  if v_fail <> '' then
    raise exception E'TEMPLATE CREATION FAILURES (rolled back):\n%\n%', v_fail, v_txt;
  end if;
  raise exception E'ALL TEMPLATE CHECKS PASSED (rolled back)\n%', v_txt;
end;
$$;
