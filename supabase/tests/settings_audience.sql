-- Owner settings and Tickd's own settings (20261010390000_internal_settings,
-- 20261022230000_tickd_sets_up_the_rules).
--
--   S1  Every setting says who it is for; the six engine settings and the
--       twelve rules Tickd sets up are internal, and the settings the
--       customer's own screens write (Settings, the set-up wizard) are not.
--   S2  A company administrator can still save an owner setting.
--   S3  The same administrator cannot write an internal setting, by insert,
--       upsert or update, and its value is unchanged afterwards.
--   S4  Without the company_settings permission, nothing is written at all
--       (unchanged by this migration; checked so the new policy did not
--       widen it).
--   S5  The administrator cannot write one of the rules Tickd sets up (the
--       overtime hours), and its value is unchanged afterwards.
--
-- Runs in one transaction and always raises, so nothing persists.

do $$
declare
  v_org uuid; v_admin uuid; v_rep uuid;
  v_before jsonb; v_after jsonb; v_n int; v_txt text;
  v_fail text := '';
begin
  select p.id, p.org_id into v_admin, v_org
    from public.profiles p join public.job_roles jr on jr.id = p.job_role_id
   where jr.code = 'administrator' and p.is_active
   order by (select o.created_at from public.organizations o where o.id = p.org_id), p.id
   limit 1;
  select id into v_rep from public.profiles
   where org_id = v_org and is_active and id <> v_admin
     and not exists (select 1 from public.profile_permissions pp
                      where pp.profile_id = profiles.id and pp.permission_code in ('company_settings', 'admin'))
   limit 1;
  if v_admin is null then
    raise exception 'Fixtures missing: no active administrator';
  end if;

  --------------------------------------------------------------- S1 catalogue
  select string_agg(key, ', ' order by key) into v_txt
    from public.setting_definitions
   where audience is null or audience not in ('owner', 'internal');
  if v_txt is not null then
    v_fail := v_fail || 'S1 settings with no audience: ' || v_txt || E'\n';
  end if;
  select string_agg(key, ', ' order by key) into v_txt
    from (values ('gps_ping_interval_minutes'), ('off_site_distance_m'), ('invalid_gps_distance_m'),
                 ('report_tabs'), ('staff_score_weights'), ('dashboard_layout')) v(key)
   where not exists (select 1 from public.setting_definitions d
                      where d.key = v.key and d.audience = 'internal');
  if v_txt is not null then
    v_fail := v_fail || 'S1 not internal: ' || v_txt || E'\n';
  end if;
  select string_agg(key, ', ' order by key) into v_txt
    from (values ('short_visit_minutes'), ('report_short_day_hours'), ('report_long_day_hours'),
                 ('report_day_normal_hours'), ('report_week_normal_hours'), ('report_sunday_is_overtime'),
                 ('reorder_after_days'), ('range_lapse_days'), ('dashboard_cards'), ('alerts_digest_time'),
                 ('alerts_patrol_gap_minutes'), ('document_style')) v(key)
   where not exists (select 1 from public.setting_definitions d
                      where d.key = v.key and d.audience = 'internal');
  if v_txt is not null then
    v_fail := v_fail || 'S1 rules Tickd sets up that are not internal: ' || v_txt || E'\n';
  end if;
  -- What Settings and the set-up wizard write must stay writable.
  select string_agg(key, ', ' order by key) into v_txt
    from (values ('checkin_radius_m'), ('auto_end_enabled'), ('auto_end_time'), ('country_code'), ('currency_code'),
                 ('brand_primary_color'), ('brand_accent_color'), ('job_report_send'), ('job_report_send_time'),
                 ('alerts_on'), ('alerts_email'), ('money_workflow'), ('money_quotes'), ('money_deposits'),
                 ('money_invoice_from_jobs'), ('money_invoice_direct'), ('money_contracts'), ('invoice_paper')) v(key)
   where not exists (select 1 from public.setting_definitions d
                      where d.key = v.key and d.audience = 'owner');
  if v_txt is not null then
    v_fail := v_fail || 'S1 settings the customer writes that are not theirs: ' || v_txt || E'\n';
  end if;

  -- Make sure the company has a row for the internal setting the checks write.
  insert into public.company_settings (org_id, key, value)
  select v_org, 'gps_ping_interval_minutes', d.default_value
    from public.setting_definitions d where d.key = 'gps_ping_interval_minutes'
  on conflict (org_id, key) do nothing;
  select value into v_before from public.company_settings
   where org_id = v_org and key = 'gps_ping_interval_minutes';

  ------------------------------------------------------- S2 owner setting
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.company_settings (org_id, key, value)
    values (v_org, 'checkin_radius_m', '120'::jsonb)
    on conflict (org_id, key) do update set value = excluded.value;
  exception when others then
    v_fail := v_fail || 'S2 the administrator could not save an owner setting: ' || sqlerrm || E'\n';
  end;

  ---------------------------------------------------- S3 internal setting
  begin
    insert into public.company_settings (org_id, key, value)
    values (v_org, 'gps_ping_interval_minutes', '1'::jsonb)
    on conflict (org_id, key) do update set value = excluded.value;
    v_fail := v_fail || 'S3 the administrator upserted an internal setting' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.company_settings set value = '2'::jsonb
     where org_id = v_org and key = 'gps_ping_interval_minutes';
    get diagnostics v_n = row_count;
    if v_n <> 0 then
      v_fail := v_fail || 'S3 the administrator updated an internal setting' || E'\n';
    end if;
  exception when insufficient_privilege then null;
  end;
  begin
    -- A key changed to an internal one on the way in.
    update public.company_settings set key = 'off_site_distance_m', value = '500'::jsonb
     where org_id = v_org and key = 'checkin_radius_m';
    get diagnostics v_n = row_count;
    if v_n <> 0 then
      v_fail := v_fail || 'S3 an owner row was turned into an internal setting' || E'\n';
    end if;
  exception when insufficient_privilege or unique_violation then null;
  end;
  reset role;
  select value into v_after from public.company_settings
   where org_id = v_org and key = 'gps_ping_interval_minutes';
  if v_after is distinct from v_before then
    v_fail := v_fail || format('S3 the internal value changed from %s to %s', v_before, v_after) || E'\n';
  end if;

  ------------------------------------------------- S4 without permission
  if v_rep is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_rep, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.company_settings (org_id, key, value)
      values (v_org, 'checkin_radius_m', '90'::jsonb)
      on conflict (org_id, key) do update set value = excluded.value;
      v_fail := v_fail || 'S4 someone without company_settings saved a setting' || E'\n';
    exception when insufficient_privilege then null;
    end;
    reset role;
  end if;

  ------------------------------------------------ S5 a rule Tickd sets up
  insert into public.company_settings (org_id, key, value)
  select v_org, 'report_day_normal_hours', d.default_value
    from public.setting_definitions d where d.key = 'report_day_normal_hours'
  on conflict (org_id, key) do nothing;
  select value into v_before from public.company_settings
   where org_id = v_org and key = 'report_day_normal_hours';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.company_settings (org_id, key, value)
    values (v_org, 'report_day_normal_hours', '3'::jsonb)
    on conflict (org_id, key) do update set value = excluded.value;
    v_fail := v_fail || 'S5 the administrator upserted a rule Tickd sets up' || E'\n';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.company_settings set value = '4'::jsonb
     where org_id = v_org and key = 'report_day_normal_hours';
    get diagnostics v_n = row_count;
    if v_n <> 0 then
      v_fail := v_fail || 'S5 the administrator updated a rule Tickd sets up' || E'\n';
    end if;
  exception when insufficient_privilege then null;
  end;
  reset role;
  select value into v_after from public.company_settings
   where org_id = v_org and key = 'report_day_normal_hours';
  if v_after is distinct from v_before then
    v_fail := v_fail || format('S5 the rule changed from %s to %s', v_before, v_after) || E'\n';
  end if;

  if v_fail <> '' then
    raise exception E'SETTINGS AUDIENCE FAILURES (rolled back):\n%', v_fail;
  end if;
  raise exception 'ALL SETTINGS AUDIENCE CHECKS PASSED (rolled back)';
end;
$$;
