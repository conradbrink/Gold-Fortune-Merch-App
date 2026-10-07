-- Creating a company from industry templates, in one transaction.
--
-- Why: requirements §6 — "Create company runs in one transaction: insert
-- company, then copy every template table into the company tables. If any step
-- fails, nothing is created." Until now a company could only be made by hand in
-- SQL, and it came out with the neutral defaults whatever its trade.
--
-- Two functions:
--
--   template_defaults(templates[])  the merged proposal for one or more
--     templates (a company may combine trades, "cleaning plus maintenance"):
--     modules are the union; words and settings come from the first (primary)
--     template that has them, then the catalogue default; checklists and forms
--     are the union, the first template winning on a shared code. The operator
--     screen previews with it and create_company builds from it, so the preview
--     and the result cannot disagree.
--
--   create_company(company, templates[], choices, owner, actor)  inserts the
--     organisation (whose triggers add roles, HR defaults and the included
--     modules), then sets exactly the chosen modules, writes the chosen
--     settings and words, names the field role in the company's staff word,
--     creates the owner's profile as Administrator, creates a checklist form
--     per chosen job type and the chosen extra forms, records the templates
--     and their versions, and writes the operator's audit row. Every value goes
--     through the same validation as an edit by the company (the settings and
--     terminology triggers, the module guard), so a bad choice fails the whole
--     creation rather than leaving half a company.
--
-- Both are callable by the service role only: the operator console calls them
-- after checking is_platform_admin(). Self-service sign-up (Stage 5) will come
-- through its own guarded path.
--
-- Also: a new company's field department is "Field Team", not "Field Sales"
-- (exact-match rewrite of provision_organization; Gold Fortune's rows are data
-- and are untouched).
--
-- Rollback: supabase/rollback/<this version>_create_company.down.sql.

create or replace function public.template_defaults(p_templates text[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_bad text;
begin
  if p_templates is null or cardinality(p_templates) = 0 then
    raise exception 'Choose at least one industry.' using errcode = '22023';
  end if;
  if cardinality(p_templates) <> (select count(distinct t) from unnest(p_templates) t) then
    raise exception 'An industry was chosen twice.' using errcode = '22023';
  end if;
  select string_agg(t, ', ') into v_bad
    from unnest(p_templates) t
   where not exists (select 1 from public.industry_templates it where it.code = t and it.is_active);
  if v_bad is not null then
    raise exception 'Unknown or retired industry template: %', v_bad using errcode = '22023';
  end if;

  return jsonb_build_object(
    'templates', (
      select jsonb_agg(jsonb_build_object('code', it.code, 'name', it.name, 'version', it.version) order by o.n)
        from unnest(p_templates) with ordinality o(code, n)
        join public.industry_templates it on it.code = o.code),
    'visit_frequency', (
      select it.default_visit_frequency from public.industry_templates it where it.code = p_templates[1]),
    'modules', (
      select coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'built', m.is_built)
                                order by m.sort_order), '[]'::jsonb)
        from public.modules m
       where exists (select 1 from public.template_modules tm
                      where tm.module_code = m.code and tm.template_code = any(p_templates))),
    'terms', (
      select jsonb_object_agg(d.key, coalesce(
               (select jsonb_build_object('one', tt.singular, 'many', tt.plural, 'article', tt.article)
                  from unnest(p_templates) with ordinality o(code, n)
                  join public.template_terminology tt on tt.template_code = o.code and tt.term_key = d.key
                 order by o.n limit 1),
               jsonb_build_object('one', d.singular, 'many', d.plural, 'article', d.article)))
        from public.term_definitions d),
    'settings', (
      select jsonb_object_agg(d.key, coalesce(
               (select ts.value
                  from unnest(p_templates) with ordinality o(code, n)
                  join public.template_settings ts on ts.template_code = o.code and ts.setting_key = d.key
                 order by o.n limit 1),
               d.default_value))
        from public.setting_definitions d),
    'checklists', (
      select coalesce(jsonb_agg(c.j order by c.n, c.sort_order), '[]'::jsonb)
        from (
          select distinct on (jt.code)
                 o.n, jt.sort_order,
                 jsonb_build_object(
                   'template', jt.template_code, 'code', jt.code, 'name', jt.name,
                   'default_duration_minutes', jt.default_duration_minutes,
                   'min_photos', jt.min_photos, 'requires_signature', jt.requires_signature,
                   'items', (select coalesce(jsonb_agg(jsonb_build_object(
                                      'text', ci.item_text, 'required', ci.required,
                                      'photo_required', ci.photo_required) order by ci.sort_order), '[]'::jsonb)
                               from public.template_checklist_items ci
                              where ci.template_code = jt.template_code and ci.job_type_code = jt.code)) as j
            from unnest(p_templates) with ordinality o(code, n)
            join public.template_job_types jt on jt.template_code = o.code
           order by jt.code, o.n) c),
    'forms', (
      select coalesce(jsonb_agg(f.j order by f.n, f.sort_order), '[]'::jsonb)
        from (
          select distinct on (tf.code)
                 o.n, tf.sort_order,
                 jsonb_build_object('template', tf.template_code, 'code', tf.code, 'name', tf.name,
                                    'description', tf.description, 'fields', tf.fields) as j
            from unnest(p_templates) with ordinality o(code, n)
            join public.template_forms tf on tf.template_code = o.code
           order by tf.code, o.n) f)
  );
end;
$function$;

revoke all on function public.template_defaults(text[]) from public, anon, authenticated;
grant execute on function public.template_defaults(text[]) to service_role;

create or replace function public.create_company(
  p_company   jsonb,
  p_templates text[],
  p_choices   jsonb default '{}'::jsonb,
  p_owner     uuid default null,
  p_actor     uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_def      jsonb := public.template_defaults(p_templates);
  v_choices  jsonb := coalesce(p_choices, '{}'::jsonb);
  v_name     text := nullif(btrim(p_company->>'name'), '');
  v_org      uuid;
  v_modules  text[];
  v_settings jsonb;
  v_terms    jsonb;
  v_bad      text;
  v_form     uuid;
  v_item     jsonb;
  v_n        int;
  r          record;
begin
  if v_name is null then
    raise exception 'A company needs a name.' using errcode = '22023';
  end if;

  ----------------------------------------------------------- the organisation
  insert into public.organizations (
    name, legal_name, industry, address, phone, support_email, website,
    vat_number, tax_number, vat_rate, timezone, default_visit_frequency,
    industries, template_versions)
  values (
    v_name,
    nullif(btrim(p_company->>'legal_name'), ''),
    (select it.name from public.industry_templates it where it.code = p_templates[1]),
    nullif(btrim(p_company->>'address'), ''),
    nullif(btrim(p_company->>'phone'), ''),
    nullif(btrim(p_company->>'support_email'), ''),
    nullif(btrim(p_company->>'website'), ''),
    nullif(btrim(p_company->>'vat_number'), ''),
    nullif(btrim(p_company->>'tax_number'), ''),
    coalesce((p_company->>'vat_rate')::numeric, 0),
    coalesce(nullif(btrim(p_company->>'timezone'), ''), 'UTC'),
    coalesce(v_choices->>'visit_frequency', v_def->>'visit_frequency'),
    p_templates,
    (select jsonb_object_agg(t->>'code', (t->>'version')::int) from jsonb_array_elements(v_def->'templates') t))
  returning id into v_org;

  ----------------------------------------------------------------- modules
  -- Exactly the chosen modules (default: every built one the templates name).
  -- On in catalogue order and off in reverse, so a dependency is always
  -- switched on before, and off after, the module that needs it; the guard
  -- refuses an unbuilt module and a missing dependency.
  if v_choices ? 'modules' then
    select array_agg(x) into v_modules from jsonb_array_elements_text(v_choices->'modules') x;
  else
    select array_agg(m->>'code') into v_modules
      from jsonb_array_elements(v_def->'modules') m where (m->>'built')::boolean;
  end if;
  v_modules := coalesce(v_modules, '{}');
  select string_agg(x, ', ') into v_bad
    from unnest(v_modules) x
   where not exists (select 1 from public.modules m where m.code = x and m.plan_type <> 'core');
  if v_bad is not null then
    raise exception 'Unknown module: %', v_bad using errcode = '22023';
  end if;

  for r in select m.code from public.modules m
            where m.code = any(v_modules) order by m.sort_order loop
    insert into public.company_modules (org_id, module_code, enabled)
    values (v_org, r.code, true)
    on conflict (org_id, module_code) do update set enabled = true;
  end loop;
  for r in select cm.module_code from public.company_modules cm
             join public.modules m on m.code = cm.module_code
            where cm.org_id = v_org and cm.enabled and not (cm.module_code = any(v_modules))
            order by m.sort_order desc loop
    update public.company_modules set enabled = false
     where org_id = v_org and module_code = r.module_code;
  end loop;

  ---------------------------------------------------------------- settings
  -- Every setting written down, as Gold Fortune's are, so a later change to a
  -- catalogue default never moves an existing company. The company's own
  -- country and currency come from its details.
  v_settings := (v_def->'settings') || coalesce(v_choices->'settings', '{}'::jsonb);
  if nullif(btrim(p_company->>'country_code'), '') is not null then
    v_settings := v_settings || jsonb_build_object('country_code', upper(btrim(p_company->>'country_code')));
  end if;
  if nullif(btrim(p_company->>'currency_code'), '') is not null then
    v_settings := v_settings || jsonb_build_object('currency_code', upper(btrim(p_company->>'currency_code')));
  end if;
  insert into public.company_settings (org_id, key, value)
  select v_org, s.key, s.value from jsonb_each(v_settings) s;

  -------------------------------------------------------------------- words
  v_terms := (v_def->'terms') || coalesce(v_choices->'terms', '{}'::jsonb);
  insert into public.company_terminology (org_id, key, singular, plural, article)
  select v_org, t.key, t.value->>'one', t.value->>'many', nullif(t.value->>'article', '')
    from jsonb_each(v_terms) t;

  -- The field role carries the company's word for its people: "Cleaner".
  update public.job_roles set name = (v_terms->'staff'->>'one')
   where org_id = v_org and code = 'sales_rep';

  ------------------------------------------------------------------ owner
  -- Before the forms, which record who created them.
  if p_owner is not null then
    insert into public.profiles (id, org_id, role, job_role_id, full_name, email)
    values (p_owner, v_org, 'manager',
            (select id from public.job_roles where org_id = v_org and code = 'administrator'),
            nullif(btrim(p_company->'owner'->>'full_name'), ''),
            nullif(btrim(p_company->'owner'->>'email'), ''));
  end if;

  -------------------------------------------------- checklists and forms
  -- A checklist per chosen job type (default: all of them): each item a
  -- tick, or a photo where the item asks for one.
  for r in select c from jsonb_array_elements(v_def->'checklists') c
            where not (v_choices ? 'checklists')
               or (c->>'code') in (select jsonb_array_elements_text(v_choices->'checklists')) loop
    insert into public.form_templates (org_id, name, description, created_by)
    values (v_org, r.c->>'name', 'Ready-made checklist: ' || (r.c->>'name') || '.', p_owner)
    returning id into v_form;
    v_n := 0;
    for v_item in select * from jsonb_array_elements(r.c->'items') loop
      v_n := v_n + 10;
      insert into public.form_fields (form_template_id, label, field_type, required, sort_order)
      values (v_form, v_item->>'text',
              case when (v_item->>'photo_required')::boolean then 'photo' else 'boolean' end,
              (v_item->>'required')::boolean, v_n);
    end loop;
  end loop;

  for r in select f from jsonb_array_elements(v_def->'forms') f
            where not (v_choices ? 'forms')
               or (f->>'code') in (select jsonb_array_elements_text(v_choices->'forms')) loop
    insert into public.form_templates (org_id, name, description, created_by)
    values (v_org, r.f->>'name', nullif(r.f->>'description', ''), p_owner)
    returning id into v_form;
    v_n := 0;
    for v_item in select * from jsonb_array_elements(r.f->'fields') loop
      v_n := v_n + 10;
      insert into public.form_fields (form_template_id, label, field_type, required, options, sort_order)
      values (v_form, v_item->>'label', v_item->>'field_type',
              coalesce((v_item->>'required')::boolean, false), v_item->'options', v_n);
    end loop;
  end loop;

  ------------------------------------------------------------------ audit
  if p_actor is not null then
    insert into public.platform_audit_log (actor_id, action, target_org_id, detail)
    values (p_actor, 'company.create', v_org,
            jsonb_build_object('templates', to_jsonb(p_templates), 'modules', to_jsonb(v_modules)));
  end if;

  return v_org;
end;
$function$;

revoke all on function public.create_company(jsonb, text[], jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_company(jsonb, text[], jsonb, uuid, uuid) to service_role;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'template_defaults', 'core'),
  ('function', 'create_company', 'core');

-- New companies' field department: "Field Team", not "Field Sales".
do $$
declare
  v_def text := pg_get_functiondef('public.provision_organization(uuid)'::regprocedure);
  c_old constant text := '(''Field Sales'', ''FIELD'', 10)';
  c_new constant text := '(''Field Team'', ''FIELD'', 10)';
begin
  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'provision_organization is not the text this migration expects';
  end if;
  execute replace(v_def, c_old, c_new);
end;
$$;
