-- Rollback of 20261009240000_document_style: the setting out again. Companies
-- that chose a look go back to the layout they had.

delete from public.company_settings where key = 'document_style';
delete from public.template_settings where setting_key = 'document_style';
delete from public.setting_definitions where key = 'document_style';
