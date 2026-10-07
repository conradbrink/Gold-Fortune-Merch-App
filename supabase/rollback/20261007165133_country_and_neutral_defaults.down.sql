-- Rollback for country_and_neutral_defaults: the functions back to their old
-- text by the same exact-match rewrite in reverse, and the country setting
-- removed.

do $$
declare
  r record;
  v_def text;
  v_seen int;
begin
  -- Each pair: the text as it stands in the function's source, its
  -- replacement, and how many times it must appear. Anything else refuses the
  -- whole rollback, so a function changed since is never half-rewritten.
  create temp table fn_rewrites (fn text, old text, new text, times int, ord serial) on commit drop;
  insert into fn_rewrites (fn, old, new, times) values
    ($m$assign_default_permissions()$m$, $m$       and jr.code = case new.role
         when 'manager'    then 'administrator'
         when 'warehouse'  then 'warehouse_clerk'
         when 'hr_manager' then 'hr_manager'
         else 'sales_rep'
       end;$m$, $m$       and jr.name = case new.role
         when 'manager'    then 'Administrator'
         when 'warehouse'  then 'Warehouse Clerk'
         when 'hr_manager' then 'HR Manager'
         else 'Sales Rep'
       end;$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$'Runs the field: schedules, check-ins, sites, staff and the warehouse.'$m$, $m$'Runs the field: schedule, visits, stores, reps and the warehouse.'$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$(p_org, 'Field Staff', 'sales_rep',$m$, $m$(p_org, 'Sales Rep', 'sales_rep',$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$('Client Relationships', 'How clients and their staff experience working with this person.', 40),$m$, $m$('Customer Relationships', 'How clients and their staff experience working with this person.', 40),$m$, 1),
    ($m$provision_organization(uuid)$m$, $m$('incident_type','customer_complaint','Client Complaint',70,'{}'),$m$, $m$('incident_type','customer_complaint','Customer Complaint',70,'{}'),$m$, 1),
    ($m$warehouse_performance(timestamp with time zone,timestamp with time zone,text)$m$, $m$coalesce(t.name, 'Unassigned') as area_name,$m$, $m$coalesce(t.name, 'No territory') as area_name,$m$, 1);

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

delete from public.company_settings where key = 'country_code';
delete from public.setting_definitions where key = 'country_code';
