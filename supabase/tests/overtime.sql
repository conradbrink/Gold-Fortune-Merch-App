-- Overtime suite (Stage 8 Part 5).
--
--   O1  The three settings exist with their types, ranges and defaults, and
--       their `report_` prefix (kept off the field settings card).
--   O2  The trades: the service trades are seeded a 9-hour day (security its
--       12-hour shift) and a 45-hour week; distribution is seeded nothing; no
--       trade is seeded a Sunday rule.
--   O3  A new cleaning company gets its trade's values.
--   O4  Gold Fortune keeps 0, 0 and off: its Hours report shows no overtime.
--       Every company has all three settings.
--   O5  A value out of range, or of the wrong type, is refused.
--
-- The arithmetic is the page's (web/tests/overtime.test.ts); no function was
-- added, so there are no grants to check.
--
-- HOW TO RUN: as reports.sql. One DO block that always ends in
-- `raise exception`, so nothing survives, including the quiet Gold Fortune
-- profile it removes and re-creates as the trial's owner.

do $$
declare
  c_gf constant uuid := '71170c8a-d53c-4a07-bdd4-97704a3cf4bc';
  c_keys constant text[] := array['report_day_normal_hours', 'report_week_normal_hours', 'report_sunday_is_overtime'];
  v_fail text := '';
  v_org uuid; v_owner uuid; v_owner_email text;
  v_t text;
  r record;
begin
  -- A login with no field data of its own becomes the trial's owner.
  select p.id, p.email into v_owner, v_owner_email from public.profiles p
   where p.org_id = c_gf and p.role <> 'manager'
     and not exists (select 1 from public.visits v where v.rep_id = p.id)
     and not exists (select 1 from public.location_pings l where l.rep_id = p.id)
     and not exists (select 1 from public.stock_locations s where s.rep_id = p.id)
   order by p.full_name limit 1;
  if v_owner is null then
    raise exception 'Fixtures missing: a quiet login is needed.';
  end if;
  delete from public.profiles where id = v_owner;

  ---------------------------------------------------------------- O1 settings
  for r in
    select e.*, d.key as got, d.value_type, d.default_value, d.min_value, d.max_value
      from (values ('report_day_normal_hours', 'integer', '0'::jsonb, 0::numeric, 24::numeric),
                   ('report_week_normal_hours', 'integer', '0'::jsonb, 0, 168),
                   ('report_sunday_is_overtime', 'boolean', 'false'::jsonb, null, null))
           as e(k, type_, default_, min_, max_)
      left join public.setting_definitions d on d.key = e.k
  loop
    if r.got is null or r.value_type is distinct from r.type_ or r.default_value is distinct from r.default_
       or r.min_value is distinct from r.min_ or r.max_value is distinct from r.max_ then
      v_fail := v_fail || format('O1 %s: %s, default %s, %s to %s', r.k, r.value_type, r.default_value,
                                 r.min_value, r.max_value) || E'\n';
    end if;
  end loop;

  ---------------------------------------------------------------- O2 the trades
  for r in
    select e.*,
           (select value from public.template_settings
             where template_code = e.code and setting_key = 'report_day_normal_hours') as day_,
           (select value from public.template_settings
             where template_code = e.code and setting_key = 'report_week_normal_hours') as week_
      from (values ('cleaning', 9), ('garden', 9), ('plumbing', 9), ('installation', 9), ('maintenance', 9),
                   ('security', 12), ('pest_control', 9), ('pool', 9), ('delivery', 9), ('generic', 9))
           as e(code, hours)
     where exists (select 1 from public.industry_templates it where it.code = e.code)
  loop
    if r.day_ is distinct from to_jsonb(r.hours) or r.week_ is distinct from '45'::jsonb then
      v_fail := v_fail || format('O2 %s is seeded a %s-hour day and a %s-hour week', r.code, r.day_, r.week_) || E'\n';
    end if;
  end loop;
  if exists (select 1 from public.template_settings
              where template_code = 'distribution' and setting_key = any (c_keys)) then
    v_fail := v_fail || 'O2 distribution is seeded an overtime rule' || E'\n';
  end if;
  if exists (select 1 from public.template_settings where setting_key = 'report_sunday_is_overtime') then
    v_fail := v_fail || 'O2 a trade is seeded a Sunday rule' || E'\n';
  end if;

  ---------------------------------------------------------------- O3 a new cleaning company
  v_org := public.start_trial_company(
    jsonb_build_object('name', 'Overtime check cleaning', 'country_code', 'ZA', 'currency_code', 'ZAR',
                       'timezone', 'Africa/Johannesburg', 'vat_rate', 15,
                       'owner', jsonb_build_object('full_name', 'Overtime Owner', 'email', v_owner_email)),
    array['cleaning'], v_owner);
  if (select value from public.company_settings where org_id = v_org and key = 'report_day_normal_hours')
       is distinct from '9'::jsonb
     or (select value from public.company_settings where org_id = v_org and key = 'report_week_normal_hours')
       is distinct from '45'::jsonb
     or (select value from public.company_settings where org_id = v_org and key = 'report_sunday_is_overtime')
       is distinct from 'false'::jsonb then
    v_fail := v_fail || 'O3 a new cleaning company did not get its trade''s 9-hour day, 45-hour week and no Sunday rule' || E'\n';
  end if;

  ---------------------------------------------------------------- O4 Gold Fortune
  if (select value from public.company_settings where org_id = c_gf and key = 'report_day_normal_hours')
       is distinct from '0'::jsonb
     or (select value from public.company_settings where org_id = c_gf and key = 'report_week_normal_hours')
       is distinct from '0'::jsonb
     or (select value from public.company_settings where org_id = c_gf and key = 'report_sunday_is_overtime')
       is distinct from 'false'::jsonb then
    v_fail := v_fail || 'O4 Gold Fortune''s overtime settings are not 0, 0 and off' || E'\n';
  end if;
  if exists (select 1 from public.organizations o cross join unnest(c_keys) as k(setting_key)
              where not exists (select 1 from public.company_settings cs
                                 where cs.org_id = o.id and cs.key = k.setting_key)) then
    v_fail := v_fail || 'O4 a company is missing an overtime setting' || E'\n';
  end if;

  ---------------------------------------------------------------- O5 validation
  v_t := '';
  for r in
    select * from (values ('report_day_normal_hours', '25'::jsonb), ('report_day_normal_hours', '-1'::jsonb),
                          ('report_day_normal_hours', '8.5'::jsonb), ('report_week_normal_hours', '169'::jsonb),
                          ('report_sunday_is_overtime', '1'::jsonb), ('report_sunday_is_overtime', '"true"'::jsonb))
           as x(k, v)
  loop
    begin
      update public.company_settings set value = r.v where org_id = v_org and key = r.k;
      v_t := v_t || format('%s = %s ', r.k, r.v);
    exception when others then null;
    end;
  end loop;
  if v_t <> '' then
    v_fail := v_fail || format('O5 accepted: %s', v_t) || E'\n';
  end if;
  begin
    update public.company_settings set value = '168'::jsonb where org_id = v_org and key = 'report_week_normal_hours';
    update public.company_settings set value = 'true'::jsonb where org_id = v_org and key = 'report_sunday_is_overtime';
  exception when others then
    v_fail := v_fail || format('O5 a 168-hour week or a Sunday rule was refused: %s', sqlerrm) || E'\n';
  end;

  if v_fail <> '' then
    raise exception E'OVERTIME FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL OVERTIME CHECKS PASSED (rolled back)';
end;
$$;
