-- Rollback of 20261009190000_vehicle_logbook: the logbook, its two tables and
-- the module's "built" mark, out again. Nothing else is touched.
--
-- It refuses to start once a vehicle exists: the vehicles and who drove them
-- are a company's tax record, and nothing here should be the thing that loses
-- it. Copy and remove them first.
--
-- Companies that had the module switched on lose the switch: before this
-- migration it could not be on (an unbuilt module is refused), so every
-- switched-on row was made after it. A switch the operator turned off again
-- is left as it is.
--
-- Run it as ONE transaction (`psql --single-transaction -f …`, or inside
-- begin … commit).

do $guard$
begin
  if exists (select 1 from public.logbook_vehicles) then
    raise exception 'Logbook vehicles exist: copy and remove them (and their vehicle days) before rolling back.';
  end if;
end;
$guard$;

delete from public.module_assignments
 where (kind, name) in (('table', 'logbook_vehicles'), ('table', 'vehicle_days'),
                        ('function', 'vehicle_logbook'));

drop function public.vehicle_logbook(timestamptz, timestamptz, uuid);
drop table public.vehicle_days;
drop table public.logbook_vehicles;

delete from public.company_modules where module_code = 'vehicle_logbook' and enabled;
update public.modules set is_built = false where code = 'vehicle_logbook';
