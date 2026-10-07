-- Rollback for tickd_default_colours: the neutral slate and teal again.
update public.setting_definitions set default_value = '"#1E293B"' where key = 'brand_primary_color';
update public.setting_definitions set default_value = '"#0EA5A4"' where key = 'brand_accent_color';
