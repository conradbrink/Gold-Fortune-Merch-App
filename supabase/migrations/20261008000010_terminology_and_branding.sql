-- Terminology and branding: each company's own words, logo and colours.
--
-- Why: the platform is opened to companies other than Gold Fortune, and the
-- requirements (Field Teams Platform, draft v6) say "No hard-coded business
-- words in UI, app, reports or PDFs. Use the terminology system" and that
-- terminology "is loaded once at login and used by the dashboard and the
-- mobile app for every label, report title and PDF". A cleaning company must
-- not see "Store visit" or Gold Fortune's navy and gold.
--
-- What:
--   * term_definitions: the catalogue of words the product uses, each with a
--     neutral default. Global, read-only, written only by migrations.
--   * company_terminology: a company's own word for a term. Missing rows fall
--     back to the default. Edited by people holding `company_settings`.
--   * brand_primary_color / brand_accent_color: two settings in the existing
--     settings catalogue, validated as #RRGGBB by company_settings_validate.
--   * organizations.logo_path and a public `branding` bucket for the logo.
--     Public so PDFs and the phone fetch it without signed URLs; a logo is
--     public by nature. Uploads only into the company's own folder, only
--     raster images (an SVG can carry script), at most 1 MB.
--   * tax_invoices.seller_logo_path, copied at issue like the other seller
--     fields, so an invoice keeps the logo it was issued with.
--   * my_company_config() gains `terms` and `branding`.
--
-- Gold Fortune keeps everything it shows today: its words (Store, Visit, Rep,
-- Chain, Territory, Customer, Lead, Call cycle, Today's route) are seeded as
-- its rows, and its colours (#16224F navy, #E0B84B gold) as its settings. Its
-- logo is uploaded separately (storage objects are not written by SQL) and its
-- logo_path set once the file is there.
--
-- Rollback: supabase/rollback/<this version>_terminology_and_branding.down.sql.

----------------------------------------------------------------- the catalogue

create table public.term_definitions (
  key          text primary key check (key ~ '^[a-z][a-z_]*$'),
  singular     text not null,
  plural       text not null,
  -- 'a' or 'an' when the first letter does not tell (an hour, a unit). Null:
  -- the client decides from the first letter.
  article      text check (article in ('a', 'an')),
  description  text not null,
  sort_order   integer not null default 0
);

insert into public.term_definitions (key, singular, plural, article, description, sort_order) values
  ('site',           'Site',             'Sites',             null, 'The place where work is done.', 10),
  ('site_group',     'Group',            'Groups',            null, 'A group of sites, such as a chain or a portfolio.', 20),
  ('job',            'Job',              'Jobs',              null, 'One check-in to check-out at a site.', 30),
  ('staff',          'Staff member',     'Staff',             null, 'A field employee who does the jobs.', 40),
  ('client',         'Client',           'Clients',           null, 'Who is billed for the work.', 50),
  ('region',         'Region',           'Regions',           null, 'The largest division of the map.', 60),
  ('territory',      'Area',             'Areas',             null, 'A division of a region that staff are assigned to.', 70),
  ('prospect',       'Lead',             'Leads',             null, 'A possible new client.', 80),
  ('schedule_cycle', 'Recurring schedule','Recurring schedules', null, 'How often each site is visited.', 90),
  ('day_plan',       'Today''s jobs',    'Today''s jobs',     null, 'The list of work for the day on the phone.', 100),
  ('workday',        'Workday',          'Workdays',          null, 'A clocked-in day, from start to end.', 110);

-------------------------------------------------------------- per company

create table public.company_terminology (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  key        text not null references public.term_definitions(key),
  singular   text not null,
  plural     text not null,
  article    text check (article in ('a', 'an')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (org_id, key)
);

-- Words reach every screen, export and PDF, so keep them to plain short text.
create or replace function public.company_terminology_validate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.singular := btrim(new.singular);
  new.plural := btrim(new.plural);
  if length(new.singular) not between 1 and 40 or length(new.plural) not between 1 and 40 then
    raise exception 'Each word needs between 1 and 40 characters.' using errcode = '22023';
  end if;
  if new.singular ~ '[<>{}[:cntrl:]]' or new.plural ~ '[<>{}[:cntrl:]]' then
    raise exception 'Words cannot contain < > { } or control characters.' using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$function$;

revoke all on function public.company_terminology_validate() from public, anon, authenticated;

create trigger company_terminology_validate
  before insert or update on public.company_terminology
  for each row execute function public.company_terminology_validate();

alter table public.term_definitions enable row level security;
alter table public.company_terminology enable row level security;

create policy term_definitions_select on public.term_definitions
  for select to authenticated using (true);
revoke insert, update, delete on public.term_definitions from anon, authenticated;
revoke all on public.term_definitions from anon;

create policy company_terminology_select on public.company_terminology
  for select to authenticated
  using (org_id = (select public.current_org_id()));
create policy company_terminology_insert on public.company_terminology
  for insert to authenticated
  with check (org_id = (select public.current_org_id())
              and (select public.has_permission('company_settings')));
create policy company_terminology_update on public.company_terminology
  for update to authenticated
  using (org_id = (select public.current_org_id())
         and (select public.has_permission('company_settings')))
  with check (org_id = (select public.current_org_id()));
-- Deleting a row puts the term back to the default.
create policy company_terminology_delete on public.company_terminology
  for delete to authenticated
  using (org_id = (select public.current_org_id())
         and (select public.has_permission('company_settings')));
revoke all on public.company_terminology from anon;

-- Gold Fortune's own words, as its screens say them today.
insert into public.company_terminology (org_id, key, singular, plural, article)
select o.id, v.key, v.singular, v.plural, null
  from public.organizations o
  cross join (values
    ('site',           'Store',         'Stores'),
    ('site_group',     'Chain',         'Chains'),
    ('job',            'Visit',         'Visits'),
    ('staff',          'Rep',           'Reps'),
    ('client',         'Customer',      'Customers'),
    ('region',         'Region',        'Regions'),
    ('territory',      'Territory',     'Territories'),
    ('prospect',       'Lead',          'Leads'),
    ('schedule_cycle', 'Call cycle',    'Call cycles'),
    ('day_plan',       'Today''s route','Today''s route'),
    ('workday',        'Workday',       'Workdays')
  ) as v(key, singular, plural)
 where o.id = '71170c8a-d53c-4a07-bdd4-97704a3cf4bc'
on conflict do nothing;

------------------------------------------------------------------ branding

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('brand_primary_color', 'Main colour',
   'The colour of the sidebar, buttons and report headings, as #RRGGBB.',
   'text', '"#1E293B"', null, null, '^#[0-9A-Fa-f]{6}$', 90),
  ('brand_accent_color', 'Accent colour',
   'The highlight colour for the current page, badges and chart accents, as #RRGGBB.',
   'text', '"#0EA5A4"', null, null, '^#[0-9A-Fa-f]{6}$', 100);

insert into public.company_settings (org_id, key, value)
values ('71170c8a-d53c-4a07-bdd4-97704a3cf4bc', 'brand_primary_color', '"#16224F"'),
       ('71170c8a-d53c-4a07-bdd4-97704a3cf4bc', 'brand_accent_color',  '"#E0B84B"')
on conflict do nothing;

-- The logo: a versioned file name per upload (logo-<anything>.png), so a new
-- logo never overwrites the file an old invoice points at, and no cache
-- serves a stale one.
alter table public.organizations add column logo_path text;
alter table public.organizations add constraint organizations_logo_path_own_folder
  check (logo_path is null
         or logo_path ~ ('^' || id::text || '/logo-[A-Za-z0-9_-]{1,40}\.(png|jpg|jpeg|webp)$'));
grant update (logo_path) on public.organizations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']);

-- Public reads go through the public URL and need no policy. These govern the
-- API: list, upload, replace and remove, only in your own company's folder,
-- only with `company_settings`, and only raster file names.
create policy branding_select on storage.objects
  for select to authenticated
  using (bucket_id = 'branding'
         and (storage.foldername(name))[1] = (select public.current_org_id())::text);
create policy branding_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding'
              and (storage.foldername(name))[1] = (select public.current_org_id())::text
              and (select public.has_permission('company_settings'))
              and lower(name) ~ '\.(png|jpg|jpeg|webp)$');
create policy branding_update on storage.objects
  for update to authenticated
  using (bucket_id = 'branding'
         and (storage.foldername(name))[1] = (select public.current_org_id())::text
         and (select public.has_permission('company_settings')))
  with check (bucket_id = 'branding'
              and (storage.foldername(name))[1] = (select public.current_org_id())::text
              and lower(name) ~ '\.(png|jpg|jpeg|webp)$');
create policy branding_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding'
         and (storage.foldername(name))[1] = (select public.current_org_id())::text
         and (select public.has_permission('company_settings')));

----------------------------------------------------------------- invoices

alter table public.tax_invoices add column seller_logo_path text;

-- Copy the logo at issue, next to the other seller fields. Rewritten from the
-- catalogue, exact match, exactly once, so the guards above it are kept as
-- they are.
do $$
declare
  v_def text := pg_get_functiondef('public.tax_invoice_issue(uuid, date)'::regprocedure);
  v_new text;
  c_cols_old constant text := 'seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email,';
  c_cols_new constant text := 'seller_name, seller_address, seller_tax_number, seller_vat_number, seller_phone, seller_email, seller_logo_path,';
  c_vals_old constant text := 'org.address, org.tax_number, org.vat_number, org.phone, org.support_email,';
  c_vals_new constant text := 'org.address, org.tax_number, org.vat_number, org.phone, org.support_email, org.logo_path,';
begin
  if (length(v_def) - length(replace(v_def, c_cols_old, ''))) / length(c_cols_old) <> 1
     or (length(v_def) - length(replace(v_def, c_vals_old, ''))) / length(c_vals_old) <> 1 then
    raise exception 'tax_invoice_issue is not the text this migration expects';
  end if;
  v_new := replace(replace(v_def, c_cols_old, c_cols_new), c_vals_old, c_vals_new);
  execute v_new;
end;
$$;

----------------------------------------------------------------- the config

-- Unchanged apart from `terms` and `branding`. The logo is a storage path;
-- clients build the public URL from their own Supabase URL.
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
    'vat_rate', (select o.vat_rate from public.organizations o where o.id = me.org),
    'terms', (
      select jsonb_object_agg(d.key, jsonb_build_object(
               'one',     coalesce(ct.singular, d.singular),
               'many',    coalesce(ct.plural, d.plural),
               'article', case when ct.key is null then d.article else ct.article end))
        from public.term_definitions d
        left join public.company_terminology ct on ct.org_id = me.org and ct.key = d.key),
    'branding', (
      select jsonb_build_object(
               'name',       btrim(o.name),
               'legal_name', nullif(btrim(o.legal_name), ''),
               'logo_path',  o.logo_path,
               'primary',    coalesce((select cs.value #>> '{}' from public.company_settings cs
                                        where cs.org_id = me.org and cs.key = 'brand_primary_color'),
                                      (select d.default_value #>> '{}' from public.setting_definitions d
                                        where d.key = 'brand_primary_color')),
               'accent',     coalesce((select cs.value #>> '{}' from public.company_settings cs
                                        where cs.org_id = me.org and cs.key = 'brand_accent_color'),
                                      (select d.default_value #>> '{}' from public.setting_definitions d
                                        where d.key = 'brand_accent_color')))
        from public.organizations o where o.id = me.org)
  ) end
  from me
$function$;

---------------------------------------------------------------- modules

-- All core: every company has words, a logo and colours (README rule 4).
insert into public.module_assignments (kind, name, module_code) values
  ('table',  'term_definitions',    'core'),
  ('table',  'company_terminology', 'core'),
  ('bucket', 'branding',            'core');
