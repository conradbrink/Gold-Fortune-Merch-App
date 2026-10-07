-- Rollback for terminology_and_branding. Restores my_company_config and
-- tax_invoice_issue exactly as they were, and removes the terms, the colour
-- settings, the logo column and the branding policies.
--
-- The `branding` bucket is removed only when it is empty. Files are never
-- deleted by SQL; empty it through the Storage API first if it must go.
-- Until then it stays (with its module assignment), harmless without policies.

delete from public.module_assignments
 where (kind, name) in (('table', 'term_definitions'), ('table', 'company_terminology'));

create or replace function public.my_company_config()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (select public.current_org_id() as org)
  select case when me.org is null then null else jsonb_build_object(
    'org_id', me.org,
    'modules', (
      select jsonb_object_agg(m.code,
               m.plan_type = 'core'
               or coalesce((select cm.enabled from public.company_modules cm
                             where cm.org_id = me.org and cm.module_code = m.code), false))
        from public.modules m),
    'settings', (
      select jsonb_object_agg(d.key,
               coalesce((select cs.value from public.company_settings cs
                          where cs.org_id = me.org and cs.key = d.key), d.default_value))
        from public.setting_definitions d),
    'timezone', (select o.timezone from public.organizations o where o.id = me.org),
    'vat_rate', (select o.vat_rate from public.organizations o where o.id = me.org)
  ) end
  from me
$function$;

do $$
declare
  v_def text := pg_get_functiondef('public.tax_invoice_issue(uuid, date)'::regprocedure);
  c_cols_new constant text := 'seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email, seller_logo_path,';
  c_cols_old constant text := 'seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email,';
  c_vals_new constant text := 'org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,';
  c_vals_old constant text := 'org.address, org.tax_number, org.vat_number, org.phone, org.support_email,';
begin
  if (length(v_def) - length(replace(v_def, c_cols_new, ''))) / length(c_cols_new) <> 1
     or (length(v_def) - length(replace(v_def, c_vals_new, ''))) / length(c_vals_new) <> 1 then
    raise exception 'tax_invoice_issue is not the text this rollback expects';
  end if;
  execute replace(replace(v_def, c_cols_new, c_cols_old), c_vals_new, c_vals_old);
end;
$$;

alter table public.tax_invoices drop column seller_logo_path;

drop policy branding_select on storage.objects;
drop policy branding_insert on storage.objects;
drop policy branding_update on storage.objects;
drop policy branding_delete on storage.objects;

do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'branding') then
    -- storage.protect_delete refuses direct deletes unless this is set. Safe
    -- here: the bucket holds no files, so nothing can be orphaned. Local to
    -- this transaction.
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'branding';
    perform set_config('storage.allow_delete_query', 'false', true);
    delete from public.module_assignments where kind = 'bucket' and name = 'branding';
  end if;
end;
$$;

alter table public.organizations drop column logo_path;

delete from public.company_settings where key in ('brand_primary_color', 'brand_accent_color');
delete from public.setting_definitions where key in ('brand_primary_color', 'brand_accent_color');

drop table public.company_terminology;
drop function public.company_terminology_validate();
drop table public.term_definitions;
