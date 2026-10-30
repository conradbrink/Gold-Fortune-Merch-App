-- Rollback of 20261030091119_paid_on_delivery: the trigger, its function and
-- the setting go. Payments it already recorded stay: they are money the
-- company took, and removing one is the office's call ("Record payment").

drop trigger if exists orders_paid_on_delivery on public.orders;
drop function if exists public.orders_paid_on_delivery();

delete from public.company_settings where key = 'money_paid_on_delivery';
delete from public.setting_definitions where key = 'money_paid_on_delivery';
