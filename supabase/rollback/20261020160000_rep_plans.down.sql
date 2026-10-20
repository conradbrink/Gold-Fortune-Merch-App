-- Rollback of 20261020160000_rep_plans: the 5-user base plan and R349 extra
-- user again, every login counted against a plan's or a pilot's places.
-- The function bodies are production's before the migration (md5 of prosrc:
-- billing_lines 908cf10f…, billing_seats_used 31f27d33…,
-- profiles_user_limit db1a18ba…, my_setup e8ca1ec4…).

do $migration$
begin
  if to_regclass('public.price_list') is not null then
    delete from public.price_list
     where code = 'base' and kind = 'base' and unit = 'reps' and active_from = date '2026-10-20';
    update public.price_list
       set active_to = null
     where kind in ('base', 'extra_user') and tier_min is null and active_to = date '2026-10-20';
    alter table public.price_list
      drop constraint price_list_tiered_unit,
      drop constraint price_list_unit_check,
      add constraint price_list_unit_check
        check (unit = any (array['company'::text, 'user'::text, 'quantity'::text, 'employees'::text])),
      add constraint price_list_check3
        check ((unit = 'employees'::text) = (tier_min is not null));
  end if;

  update public.platform_settings
     set description = 'Most active logins a company on trial may have.'
   where key = 'trial_user_limit';

  if to_regprocedure('public.billing_lines(uuid, text, jsonb, boolean)') is not null then
    execute $ddl$
CREATE OR REPLACE FUNCTION public.billing_lines(p_org uuid, p_period text, p_plan jsonb, p_with_setup boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seats    int := (p_plan->>'seats')::int;
  v_custom   bigint;
  v_lines    jsonb := '[]'::jsonb;
  v_base     public.price_list;
  v_row      public.price_list;
  v_extra    int;
  v_qty      int;
  v_count    int;
  a          record;
begin
  if p_period is null or p_period not in ('monthly', 'yearly') then
    raise exception 'Choose monthly or yearly.' using errcode = '22023';
  end if;
  if v_seats is null or v_seats < 1 or v_seats > 1000 then
    raise exception 'The number of users must be between 1 and 1000.' using errcode = '22023';
  end if;
  if p_plan->'addons' is not null and jsonb_typeof(p_plan->'addons') <> 'object' then
    raise exception 'Add-ons are not understood.' using errcode = '22023';
  end if;

  select custom_price_cents into v_custom from public.company_account where org_id = p_org;
  if v_custom is not null then
    return jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'code', 'custom', 'label', 'Plan as agreed', 'quantity', 1,
        'unit_cents', v_custom, 'amount_cents', v_custom)),
      'total_cents', v_custom, 'custom', true);
  end if;

  select * into v_base from public.price_list
   where code = 'base' and kind = 'base' and period = p_period
     and active_from <= current_date and (active_to is null or active_to > current_date)
   order by active_from desc limit 1;
  if v_base.id is null then
    raise exception 'No % base price is set.' , p_period using errcode = '22023';
  end if;
  v_lines := v_lines || jsonb_build_object('code', 'base', 'label', v_base.label, 'quantity', 1,
               'unit_cents', v_base.amount_cents, 'amount_cents', v_base.amount_cents);

  v_extra := greatest(v_seats - v_base.included_users, 0);
  if v_extra > 0 then
    select * into v_row from public.price_list
     where kind = 'extra_user' and period = p_period
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_row.id is null then
      raise exception 'No % extra-user price is set.', p_period using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', v_extra,
                 'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents * v_extra);
  end if;

  for a in select key, value from jsonb_each(coalesce(p_plan->'addons', '{}'::jsonb)) order by key loop
    if jsonb_typeof(a.value) <> 'number' then
      raise exception 'Add-on % has no quantity.', a.key using errcode = '22023';
    end if;
    v_qty := (a.value #>> '{}')::int;
    continue when v_qty = 0;
    if v_qty < 0 or v_qty > 100 then
      raise exception 'Add-on % quantity must be between 0 and 100.', a.key using errcode = '22023';
    end if;
    if not exists (select 1 from public.modules m
                    where m.code = a.key and m.plan_type = 'addon' and m.is_built) then
      raise exception '% is not an add-on that can be bought.', a.key using errcode = '22023';
    end if;

    select * into v_row from public.price_list
     where code = a.key and kind = 'addon' and period = p_period
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_row.id is null then
      raise exception 'No % price is set for add-on %.', p_period, a.key using errcode = '22023';
    end if;

    if v_row.unit = 'employees' then
      if v_qty <> 1 then
        raise exception 'Add-on % is on or off (quantity 1).', a.key using errcode = '22023';
      end if;
      select count(*) into v_count from public.hr_employees e
       where e.org_id = p_org and e.employment_status = 'active';
      select * into v_row from public.price_list
       where code = a.key and kind = 'addon' and period = p_period
         and v_count between tier_min and coalesce(tier_max, 2147483647)
         and active_from <= current_date and (active_to is null or active_to > current_date)
       order by active_from desc limit 1;
      if v_row.id is null then
        raise exception '% for % employees is priced on request. Talk to us.', a.key, v_count
          using errcode = '22023', hint = 'quote';
      end if;
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'tier_min', v_row.tier_min,
                   'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents);
    elsif v_row.unit = 'quantity' then
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', v_qty,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents * v_qty);
    else
      if v_qty <> 1 then
        raise exception 'Add-on % is on or off (quantity 1).', a.key using errcode = '22023';
      end if;
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents);
    end if;
  end loop;

  if p_with_setup and p_period = 'monthly' then
    select * into v_row from public.price_list
     where kind = 'setup'
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_row.id is not null and v_row.amount_cents > 0 then
      v_lines := v_lines || jsonb_build_object('code', v_row.code, 'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents, 'once', true);
    end if;
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'total_cents', (select coalesce(sum((l->>'amount_cents')::bigint), 0) from jsonb_array_elements(v_lines) l),
    'custom', false);
end;
$function$
$ddl$;
  end if;

  if to_regprocedure('public.billing_seats_used(uuid, jsonb)') is not null then
    execute $ddl$
CREATE OR REPLACE FUNCTION public.billing_seats_used(p_org uuid, p_plan jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total int;
  v_free  int := 0;
  r       record;
begin
  select count(*) into v_total from public.profiles where org_id = p_org and is_active;
  for r in
    select p.included_users * greatest(coalesce((p_plan->'addons'->>p.code)::int, 0), 0) as slots,
           p.included_roles
      from public.price_list p
     where p.kind = 'addon' and p.included_users > 0 and p.included_roles is not null
       and p.period = 'monthly'
       and p.active_from <= current_date and (p.active_to is null or p.active_to > current_date)
  loop
    if r.slots > 0 then
      v_free := v_free + least(r.slots, (select count(*) from public.profiles
                                          where org_id = p_org and is_active and role = any (r.included_roles)));
    end if;
  end loop;
  return v_total - v_free;
end;
$function$
$ddl$;
  end if;

  if to_regprocedure('public.profiles_user_limit()') is not null then
    execute $ddl$
CREATE OR REPLACE FUNCTION public.profiles_user_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a       public.company_account;
  v_limit int;
  v_used  int;
begin
  -- Serialises logins being added to one company, so two at once cannot both
  -- take the last place.
  select * into a from public.company_account where org_id = new.org_id for update;
  if a.org_id is null or a.status = 'exempt' then
    return null;
  end if;
  if a.status = 'trial' or a.plan is null then
    v_limit := coalesce((public.platform_setting('trial_user_limit') #>> '{}')::int, 10);
    select count(*) into v_used from public.profiles where org_id = new.org_id and is_active;
  else
    v_limit := (a.plan->>'seats')::int;
    v_used := public.billing_seats_used(new.org_id, a.plan);
  end if;
  if v_used > v_limit then
    raise exception 'All % user places on your plan are taken.', v_limit
      using errcode = 'P0001', hint = 'user_limit';
  end if;
  return null;
end;
$function$
$ddl$;
  end if;
end
$migration$;

CREATE OR REPLACE FUNCTION public.my_setup()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid := public.current_org_id();
  a public.company_account;
  v_industries text[];
  v_country text;
  v_limit int;
  v_used int;
begin
  if v_org is null or not public.has_permission('company_settings') then
    raise exception 'Only someone who manages the company settings can set it up.' using errcode = '42501';
  end if;
  select * into a from public.company_account where org_id = v_org;
  select coalesce(o.industries, '{}') into v_industries from public.organizations o where o.id = v_org;
  v_country := upper(coalesce(public.org_setting(v_org, 'country_code') #>> '{}', ''));
  -- The places rule of profiles_user_limit: the trial's, or the plan's seats.
  if a.org_id is not null and a.status is distinct from 'exempt' then
    if a.status = 'trial' or a.plan is null then
      v_limit := coalesce((public.platform_setting('trial_user_limit') #>> '{}')::int, 10);
      select count(*) into v_used from public.profiles p where p.org_id = v_org and p.is_active;
    else
      v_limit := (a.plan->>'seats')::int;
      v_used := public.billing_seats_used(v_org, a.plan);
    end if;
  end if;
  return jsonb_build_object(
    'show', coalesce(a.org_id is not null and a.status is distinct from 'exempt' and a.wizard_finished_at is null, false),
    'step', a.wizard_step,
    'finished_at', a.wizard_finished_at,
    'industries', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name) order by array_position(v_industries, t.code))
        from public.industry_templates t where t.code = any(v_industries)), '[]'::jsonb),
    -- How the main trade usually gets paid, to mark it among the choices.
    'trade_workflow', (select ts.value #>> '{}' from public.template_settings ts
                        where ts.template_code = v_industries[1] and ts.setting_key = 'money_workflow'),
    'counts', jsonb_build_object(
      'sites', (select count(*) from public.stores x where x.org_id = v_org),
      'people', (select count(*) from public.profiles x where x.org_id = v_org and x.is_active),
      'checklists', (select count(*) from public.form_templates x where x.org_id = v_org and x.active),
      'items', (select count(*) from public.service_items x where x.org_id = v_org and x.active),
      'priced_items', (select count(*) from public.service_items x where x.org_id = v_org and x.active and x.unit_price > 0),
      'products', (select count(*) from public.products x where x.org_id = v_org),
      'quotes', (select count(*) from public.quotes x where x.org_id = v_org),
      'contracts', (select count(*) from public.service_contracts x where x.org_id = v_org),
      'checkins', (select count(*) from public.visits x where x.org_id = v_org and x.checkin_at is not null)),
    'places', case when v_limit is null then null else jsonb_build_object('used', v_used, 'limit', v_limit) end,
    'country_code', nullif(v_country, ''),
    'vat_rate_default', public.platform_setting('country_defaults') -> v_country -> 'vat_rate');
end;
$function$;
