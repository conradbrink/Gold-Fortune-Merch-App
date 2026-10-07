-- The product's default colours become Tickd's: teal #0F3D3E and amber
-- #F5A524 (owner, 7 Oct 2026), in place of the neutral slate and teal chosen
-- before the product had a name. They apply to a company that has not picked
-- its own colours; Gold Fortune has its own navy and gold stored, so nothing
-- changes for it. The web (lib/branding.ts) and the phone (lib/core/product.dart)
-- carry the same values as fallbacks.
--
-- Rollback: supabase/rollback/20261007170802_tickd_default_colours.down.sql.

update public.setting_definitions set default_value = '"#0F3D3E"'
 where key = 'brand_primary_color' and default_value = '"#1E293B"';
update public.setting_definitions set default_value = '"#F5A524"'
 where key = 'brand_accent_color' and default_value = '"#0EA5A4"';

do $$
begin
  if (select count(*) from public.setting_definitions
       where (key, default_value) in (('brand_primary_color', '"#0F3D3E"'::jsonb),
                                      ('brand_accent_color', '"#F5A524"'::jsonb))) <> 2 then
    raise exception 'The colour defaults were not the values this migration expects';
  end if;
end;
$$;
