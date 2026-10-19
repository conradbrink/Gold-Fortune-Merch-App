-- Rollback of 20261019180000_store_range: the range functions, the pins and
-- exclusions, the store size column, the range settings and the dashboard
-- card go. Nothing else read them.
--
-- Refuses while any company has pinned a product or marked one "Not for this
-- store", or set a store's size by hand: those are decisions somebody made,
-- and dropping them would lose them without a word. Clear them deliberately
-- first (the Ranges page, the store dialog), or take a copy of range_pins,
-- store_range_exclusions and stores.size_override, then run this.

do $$
begin
  if exists (select 1 from public.range_pins)
     or exists (select 1 from public.store_range_exclusions)
     or exists (select 1 from public.stores where size_override is not null) then
    raise exception 'Range decisions exist (% pins, % exclusions, % store sizes). Clear or copy them before rolling back.',
      (select count(*) from public.range_pins),
      (select count(*) from public.store_range_exclusions),
      (select count(*) from public.stores where size_override is not null);
  end if;
end $$;

update public.company_settings
   set value = to_jsonb(array_to_string(array_remove(string_to_array(value #>> '{}', ','), 'store_range'), ','))
 where key = 'dashboard_layout'
   and 'store_range' = any (string_to_array(value #>> '{}', ','));
update public.template_settings
   set value = to_jsonb(array_to_string(array_remove(string_to_array(value #>> '{}', ','), 'store_range'), ','))
 where setting_key = 'dashboard_layout'
   and 'store_range' = any (string_to_array(value #>> '{}', ','));

delete from public.module_assignments
 where (kind = 'table' and name in ('range_pins', 'store_range_exclusions'))
    or (kind = 'function' and name in ('range_status', 'range_products',
                                       'range_grid', 'range_pin_set', 'range_pin_clear',
                                       'store_range_exclude', 'store_range_include'));

drop function public.store_range_include(uuid, uuid[]);
drop function public.store_range_exclude(uuid, uuid[], text);
drop function public.range_pin_clear(uuid, uuid);
drop function public.range_pin_set(uuid, uuid, text, text);
drop function public.range_grid(uuid);
drop function public.range_products();
drop function public.range_status(integer);
drop function public.range_facts(uuid, integer);
drop function public.range_product_results(uuid);

drop table public.store_range_exclusions;
drop table public.range_pins;
alter table public.stores drop column size_override;

delete from public.company_settings where key like 'range\_%';
delete from public.setting_definitions where key like 'range\_%';
