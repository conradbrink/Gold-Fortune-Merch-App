-- Rollback for founding_applications: the applications and the spots-left
-- setting go. The applications are the owner's list of people to call: export
-- them first (select * from public.founding_applications) if any are still
-- being worked.

delete from public.module_assignments
 where (kind = 'function' and name = 'founding_spots_left')
    or (kind = 'table' and name = 'founding_applications');

drop function public.founding_spots_left();
drop table public.founding_applications;
delete from public.platform_settings where key = 'founding_spots_left';
