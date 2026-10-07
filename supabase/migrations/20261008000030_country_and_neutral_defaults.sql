-- The company's country, and neutral seeds for new companies.
--
-- Why: geocoding was hard-coded to Botswana — every address had "Botswana"
-- appended, Google was biased to .bw and a result outside a hand-drawn box
-- was refused — so a company anywhere else could not put its sites on the
-- map. The country becomes a company setting (requirements: "No hard-coded
-- settings"; decided 7 Oct 2026). Gold Fortune is BW, so nothing changes for
-- it.
--
-- And the defaults a *new* company is provisioned with stop saying rep and
-- customer: its field role is "Field Staff", its operations manager's
-- description and two HR labels are neutral. Gold Fortune's existing rows are
-- data and are not touched.
--
-- One fix on the way: `assign_default_permissions` found a new person's job
-- role by its *name* ("Sales Rep", "Administrator"…). A company that renamed
-- one — and with these new names, every new company — would have new people
-- arrive with no role and no permissions. It now matches the role's code,
-- which never changes. Gold Fortune's roles carry exactly those codes.
--
-- And `warehouse_performance` labels stock with no area "Unassigned", not
-- "No territory": the only business word the database itself put on screen.
--
-- Rewrites are exact-match and exactly-once, as in neutral_messages.
--
-- Rollback: supabase/rollback/<this version>_country_and_neutral_defaults.down.sql.

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('country_code', 'Country',
   'ISO code of the country your sites are in, such as BW or ZA. Used to find addresses on the map. Blank means anywhere.',
   'text', '""', null, null, '^([A-Z]{2})?$', 85);

insert into public.company_settings (org_id, key, value)
values ('71170c8a-d53c-4a07-bdd4-97704a3cf4bc', 'country_code', '"BW"')
on conflict do nothing;

do $$
declare
  r record;
  v_def text;
  v_seen int;
begin
  -- Each pair: the text as it stands in the function's source, its
  -- replacement, and how many times it must appear. Anything else refuses the
  -- whole migration, so a function changed since is never half-rewritten.
  create temp table fn_rewrites (fn text, old text, new text, times int, ord serial) on commit drop;
  insert into fn_rewrites (fn, old, new, times) values
    ($m$assign_default_permissions()$m$, $m$       and jr.name = case new.role
         when 'manager'    then 'Administrator'
         when 'warehouse'  then 'Warehouse Clerk'
         when 'hr_manager' then 'HR Manager'
         else 'Sales Rep'
       end;$m$, $m$       and jr.code = case new.role
         when 'manager'    then 'administrator'
         when 'warehouse'  then 'warehouse_clerk'
         when 'hr_manager' then 'hr_manager'
         else 'sales_rep'
       end;$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$'Runs the field: schedule, visits, stores, reps and the warehouse.'$m$, $m$'Runs the field: schedules, check-ins, sites, staff and the warehouse.'$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$(p_org, 'Sales Rep', 'sales_rep',$m$, $m$(p_org, 'Field Staff', 'sales_rep',$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$('Customer Relationships', 'How clients and their staff experience working with this person.', 40),$m$, $m$('Client Relationships', 'How clients and their staff experience working with this person.', 40),$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$('incident_type','customer_complaint','Customer Complaint',70,'{}'),$m$, $m$('incident_type','customer_complaint','Client Complaint',70,'{}'),$m$, 1),
    ($m$warehouse_performance(timestamp with time zone,timestamp with time zone,text)$m$, $m$coalesce(t.name, 'No territory') as area_name,$m$, $m$coalesce(t.name, 'Unassigned') as area_name,$m$, 1);

  for r in select fn, array_agg(old order by ord) olds, array_agg(new order by ord) news,
                  array_agg(times order by ord) times
             from fn_rewrites group by fn order by fn
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    for i in 1 .. array_length(r.olds, 1) loop
      v_seen := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      if v_seen <> r.times[i] then
        raise exception '%: expected "%" % time(s), found %', r.fn, r.olds[i], r.times[i], v_seen;
      end if;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    end loop;
    execute v_def;
  end loop;
  drop table fn_rewrites;
end;
$$;
