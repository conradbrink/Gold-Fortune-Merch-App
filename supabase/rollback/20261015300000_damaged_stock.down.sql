-- Rollback of 20261015300000_damaged_stock. Refuses while reports exist: they
-- are what the reps found in the shops, and dropping them is not a rollback.
-- The `damage-photos` bucket stays: Supabase refuses to delete storage rows
-- from SQL ("Use the Storage API instead"). With its policies dropped and
-- its module registration removed, nobody can read or write it; delete it
-- from the dashboard's Storage page if it should go too.

do $$
begin
  if exists (select 1 from public.damage_reports) then
    raise exception 'damage_reports has rows; export them before rolling back';
  end if;
end $$;

delete from public.module_assignments where kind = 'table' and name = 'damage_reports';
drop table public.damage_reports;
drop function public.damage_reports_stamp();

drop policy damage_photos_select on storage.objects;
drop policy damage_photos_insert on storage.objects;
drop policy damage_photos_update on storage.objects;
drop policy module_gate_damage_photos on storage.objects;
delete from public.module_assignments where kind = 'bucket' and name = 'damage-photos';
