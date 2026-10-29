-- Stock control and HR: one add-on, R495 a month for both (owner, 29 Oct 2026).
--
-- The site sells "Stock control and HR, R495 a month for both" (#239). The
-- price list still priced the two apart from 1 Oct: the warehouse at R499 a
-- month per warehouse, HR at R199 or R499 by the number of employees. Nothing
-- was ever charged on those rows: the app sells plans by reps only and passes
-- no add-ons (web/app/(dashboard)/billing/actions.ts), and no company's plan
-- has one.
--
-- price_list.bundle names add-ons sold together at one price. billing_lines
-- writes one line for a bundle, with the bundle as its code, however many of
-- its add-ons a plan has. billing_change_lines compares lines by code, so
-- adding the second add-on of a bundle a company already pays for costs
-- nothing, in whichever order the two were bought. billing_apply_addons, which
-- switches a paid plan's add-ons on and off, brings the rest of the bundle
-- with each one: paying for Stock control switches HR on too, and Stock
-- control comes with HR wherever the company can have it (it needs Deliveries
-- and Distribution).
--
-- The old rows end today and stay on record; the new ones start today, flat
-- (unit 'company'): R495 a month, R4,950 a year (2 months free, as the plans).
-- The bundle is one price whatever the number of warehouses or employees, and
-- includes no logins: since 20261029223700 only reps and drivers take a place.
--
-- Runs after 20261029224700_deliveries_in_the_plan, which names the warehouse
-- add-on "Stock control": its rename is anchored on the old row's label, which
-- this would otherwise have ended first.

do $$
begin
  if (select name from public.modules where code = 'warehouse') is distinct from 'Stock control' then
    raise exception 'Apply 20261029224700_deliveries_in_the_plan first: the warehouse add-on is not called Stock control yet.';
  end if;
end;
$$;

alter table public.price_list
  add column bundle text check (bundle ~ '^[a-z][a-z_]*$'),
  add constraint price_list_bundle_addon check (bundle is null or kind = 'addon');

comment on column public.price_list.bundle is
  'Add-ons sold together at one price share a bundle: billing_lines writes one line for it, coded with the bundle, however many of its add-ons a plan has.';

update public.price_list
   set active_to = current_date
 where kind = 'addon' and code in ('hr', 'warehouse') and active_to is null;

insert into public.price_list
  (code, kind, period, module_code, unit, tier_min, tier_max, amount_cents, included_users, included_roles,
   label, active_from, bundle)
values
  ('hr',        'addon', 'monthly', 'hr',        'company', null, null,  49500, 0, null, 'Stock control and HR', current_date, 'stock_control_hr'),
  ('hr',        'addon', 'yearly',  'hr',        'company', null, null, 495000, 0, null, 'Stock control and HR', current_date, 'stock_control_hr'),
  ('warehouse', 'addon', 'monthly', 'warehouse', 'company', null, null,  49500, 0, null, 'Stock control and HR', current_date, 'stock_control_hr'),
  ('warehouse', 'addon', 'yearly',  'warehouse', 'company', null, null, 495000, 0, null, 'Stock control and HR', current_date, 'stock_control_hr');

-- billing_lines: a bundle is one line. Changed in place on its live
-- definition, anchored on the exact text it has now: if the anchor is not
-- found exactly once, nothing is changed.
do $$
declare
  def text := pg_get_functiondef('public.billing_lines(uuid, text, jsonb, boolean)'::regprocedure);
  anchor constant text := $a$
    if v_row.unit = 'employees' then
$a$;
  branch constant text := $b$
    -- Add-ons sold together at one price (price_list.bundle, 20261029233700):
    -- one line for the bundle, coded with it, however many of its add-ons
    -- the plan has.
    -- A bundle is on or off: a quantity left from a per-warehouse price
    -- still counts once.
    if v_row.bundle is not null then
      continue when exists (select 1 from jsonb_array_elements(v_lines) l where l->>'code' = v_row.bundle);
      v_lines := v_lines || jsonb_build_object('code', v_row.bundle, 'label', v_row.label, 'quantity', 1,
                   'unit_cents', v_row.amount_cents, 'amount_cents', v_row.amount_cents);
      continue;
    end if;
$b$;
begin
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'billing_lines: expected 1 of the anchor "%"', anchor;
  end if;
  execute replace(def, anchor, branch || substr(anchor, 2));
end;
$$;

-- billing_apply_addons: an add-on brings the rest of its bundle. A bundle mate
-- whose own requirements are off is left off, and one that something still
-- needs is not switched off.
create or replace function public.billing_apply_addons(p_org uuid, p_on jsonb, p_off text[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  k text;
  v_asked text[] := array(select jsonb_object_keys(coalesce(p_on, '{}'::jsonb)));
  v_on    text[];
  v_off   text[];
begin
  -- The add-ons that share a bundle with these, on today's prices.
  v_on := v_asked || array(
    select distinct p2.code
      from public.price_list p1
      join public.price_list p2 on p2.bundle = p1.bundle and p2.kind = 'addon'
                               and p2.active_from <= current_date and (p2.active_to is null or p2.active_to > current_date)
     where p1.kind = 'addon' and p1.code = any (v_asked) and p2.code <> all (v_asked)
       and p1.active_from <= current_date and (p1.active_to is null or p1.active_to > current_date));
  v_off := coalesce(p_off, '{}'::text[]) || array(
    select distinct p2.code
      from public.price_list p1
      join public.price_list p2 on p2.bundle = p1.bundle and p2.kind = 'addon'
                               and p2.active_from <= current_date and (p2.active_to is null or p2.active_to > current_date)
     where p1.kind = 'addon' and p1.code = any (coalesce(p_off, '{}'::text[])) and p2.code <> all (v_on)
       and p1.active_from <= current_date and (p1.active_to is null or p1.active_to > current_date));

  foreach k in array v_on loop
    -- A bundle mate the company cannot have yet stays off.
    continue when k <> all (v_asked) and exists (
      select 1 from public.module_dependencies d
       where d.module_code = k
         and not exists (select 1 from public.company_modules cm
                          where cm.org_id = p_org and cm.module_code = d.requires_code and cm.enabled));
    insert into public.company_modules (org_id, module_code, enabled)
    values (p_org, k, true)
    on conflict (org_id, module_code) do update set enabled = true
      where public.company_modules.enabled is distinct from true;
  end loop;
  foreach k in array v_off loop
    -- A bundle mate another switched-on module needs stays on.
    continue when k <> all (coalesce(p_off, '{}'::text[])) and exists (
      select 1 from public.module_dependencies d
        join public.company_modules cm on cm.org_id = p_org and cm.module_code = d.module_code and cm.enabled
       where d.requires_code = k);
    update public.company_modules set enabled = false
     where org_id = p_org and module_code = k and enabled;
  end loop;
end;
$function$;
