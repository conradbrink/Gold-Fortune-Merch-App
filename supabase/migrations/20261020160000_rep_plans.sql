-- Three fixed plans by the number of reps (owner, 19 Oct 2026; the sales site
-- and the app's Plans page show them since #184 and #192), in place of a base
-- plan with 5 users at R1,499 and R349 for each extra user:
--
--   up to 5 reps   R1,995 a month   R19,950 a year
--   up to 10 reps  R3,495 a month   R34,950 a year
--   up to 15 reps  R5,995 a month   R59,950 a year   (more: priced on request)
--
-- Only reps count (owner, 20 Oct 2026): a login with the `rep` role. Managers,
-- office and warehouse logins are free. So:
--
-- * price_list gets a base price per band of reps (unit 'reps', tier_min to
--   tier_max), from 20 Oct 2026. The 5-user base rows and the extra-user rows
--   end that day, so the old prices stay on record. Setup (R2,500, free on
--   yearly) and the add-ons are unchanged.
-- * billing_lines() charges the band the plan's places fall in, and no extra
--   users. A plan above the last band is refused with hint 'quote' (talk to
--   us), as HR above 30 employees is. With no banded rows it works as before.
-- * billing_seats_used() counts active reps only, so a plan's places are rep
--   places; profiles_user_limit() only stops a rep being added, and on a free
--   pilot counts reps against trial_user_limit (10: the Founding pilot is for
--   up to 10 reps). my_setup() shows the same count as the wizard's places.
--
-- No company pays yet (billing is not switched on: Gf motors is on its pilot,
-- Gold Fortune is exempt), so no running plan changes price.
--
-- price_list, billing_lines, billing_seats_used and profiles_user_limit come
-- from 20261008091250_billing (on the billing branch, #91; applied on
-- production). On a database without them only my_setup() changes.
--
-- Rollback: supabase/rollback/20261020160000_rep_plans.down.sql.

do $migration$
declare
  c record;
begin
  if to_regclass('public.price_list') is null then
    raise notice 'price_list does not exist yet; no prices to change.';
  else
    -- A base price can be for a band of reps.
    for c in
      select conname from pg_constraint
       where conrelid = 'public.price_list'::regclass and contype = 'c'
         and (pg_get_constraintdef(oid) like '%unit = ANY%'
              or pg_get_constraintdef(oid) like '%(unit = ''employees''::text) = (tier_min IS NOT NULL)%')
    loop
      execute format('alter table public.price_list drop constraint %I', c.conname);
    end loop;
    alter table public.price_list
      add constraint price_list_unit_check
        check (unit in ('company', 'user', 'quantity', 'employees', 'reps')),
      add constraint price_list_tiered_unit
        check ((unit in ('employees', 'reps')) = (tier_min is not null));

    update public.price_list
       set active_to = date '2026-10-20'
     where kind in ('base', 'extra_user') and tier_min is null
       and active_from < date '2026-10-20' and active_to is null;

    insert into public.price_list
      (code, kind, period, module_code, unit, tier_min, tier_max, amount_cents, included_users, included_roles, label, active_from)
    values
      ('base', 'base', 'monthly', null, 'reps', 0, 5, 199500, 0, null, 'Plan for up to 5 reps', date '2026-10-20'),
      ('base', 'base', 'monthly', null, 'reps', 6, 10, 349500, 0, null, 'Plan for up to 10 reps', date '2026-10-20'),
      ('base', 'base', 'monthly', null, 'reps', 11, 15, 599500, 0, null, 'Plan for up to 15 reps', date '2026-10-20'),
      ('base', 'base', 'yearly', null, 'reps', 0, 5, 1995000, 0, null, 'Plan for up to 5 reps', date '2026-10-20'),
      ('base', 'base', 'yearly', null, 'reps', 6, 10, 3495000, 0, null, 'Plan for up to 10 reps', date '2026-10-20'),
      ('base', 'base', 'yearly', null, 'reps', 11, 15, 5995000, 0, null, 'Plan for up to 15 reps', date '2026-10-20');
  end if;

  update public.platform_settings
     set description = 'Most active reps a company on its free pilot may have; office and warehouse logins do not count.'
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
    raise exception 'The number of places must be between 1 and 1000.' using errcode = '22023';
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

  -- The plans by band of reps (20261020160000): the band the plan's places
  -- fall in. Above the last band it is priced on request.
  if exists (select 1 from public.price_list
              where code = 'base' and kind = 'base' and period = p_period and tier_min is not null
                and active_from <= current_date and (active_to is null or active_to > current_date)) then
    select * into v_base from public.price_list
     where code = 'base' and kind = 'base' and period = p_period and tier_min is not null
       and v_seats between tier_min and coalesce(tier_max, 2147483647)
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_base.id is null then
      raise exception 'A plan for % reps is priced on request. Talk to us.', v_seats
        using errcode = '22023', hint = 'quote';
    end if;
  else
    select * into v_base from public.price_list
     where code = 'base' and kind = 'base' and period = p_period
       and active_from <= current_date and (active_to is null or active_to > current_date)
     order by active_from desc limit 1;
    if v_base.id is null then
      raise exception 'No % base price is set.' , p_period using errcode = '22023';
    end if;
  end if;
  v_lines := v_lines || jsonb_build_object('code', 'base', 'label', v_base.label, 'quantity', 1,
               'unit_cents', v_base.amount_cents, 'amount_cents', v_base.amount_cents);

  -- A banded plan has no extra users: the band is the price.
  v_extra := case when v_base.tier_min is null then greatest(v_seats - v_base.included_users, 0) else 0 end;
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
  -- A plan's places are for reps (20261020160000): managers, office and
  -- warehouse logins are free.
  select count(*) into v_total from public.profiles where org_id = p_org and is_active and role = 'rep';
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
                                          where org_id = p_org and is_active and role = 'rep'
                                            and role = any (r.included_roles)));
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
  -- Only reps take a place (20261020160000).
  if new.role is distinct from 'rep' then
    return null;
  end if;
  -- Serialises logins being added to one company, so two at once cannot both
  -- take the last place.
  select * into a from public.company_account where org_id = new.org_id for update;
  if a.org_id is null or a.status = 'exempt' then
    return null;
  end if;
  if a.status = 'trial' or a.plan is null then
    v_limit := coalesce((public.platform_setting('trial_user_limit') #>> '{}')::int, 10);
    select count(*) into v_used from public.profiles where org_id = new.org_id and is_active and role = 'rep';
  else
    v_limit := (a.plan->>'seats')::int;
    v_used := public.billing_seats_used(new.org_id, a.plan);
  end if;
  if v_used > v_limit then
    raise exception 'All % places on your plan are taken.', v_limit
      using errcode = 'P0001', hint = 'user_limit';
  end if;
  return null;
end;
$function$
$ddl$;
  end if;
end
$migration$;

-- The wizard's places: reps only, as profiles_user_limit counts them.
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
  -- The places rule of profiles_user_limit: the trial's, or the plan's seats; reps only.
  if a.org_id is not null and a.status is distinct from 'exempt' then
    if a.status = 'trial' or a.plan is null then
      v_limit := coalesce((public.platform_setting('trial_user_limit') #>> '{}')::int, 10);
      select count(*) into v_used from public.profiles p where p.org_id = v_org and p.is_active and p.role = 'rep';
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
