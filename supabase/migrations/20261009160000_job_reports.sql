-- Stage 8.3: the signed job report. The sales site promises that "your client
-- gets a signed report for the job"; this keeps that promise without a phone
-- release.
--
-- * job_reports: one per finished job, made when it is first sent or opened.
--   The client opens it from a private link (the server signs the report's id;
--   the link stops working when the report expires or is withdrawn), sees who
--   did the job, when, whether they checked in on site, every checklist answer
--   and the photos, and signs it in their own browser: their name, their
--   signature, the time and the device are kept.
-- * Settings `job_report_send` (immediate / evening / manual) and
--   `job_report_send_time` (the evening's hour, the company's own clock),
--   seeded per trade: the service trades send each site's day in one email in
--   the evening; distribution sends nothing unless asked, so Gold Fortune's
--   clients get nothing new.
-- * queue_job_reports(), every 15 minutes (pg_cron "job-reports"): for each
--   company that sends, the finished jobs not yet sent, to every contact at
--   that site who gets reports and has an email (Stage 8.2), through the outbox
--   (Stage 8.1). A company with no contacts sends nothing.
-- * In the app: send_job_report() ("Send to the client now"),
--   job_report_for_visit() (the link to copy), and job_reports readable by
--   people who read reports or invoices, for "Signed" / "Not signed yet".
-- * For the server only (service role, after it checked the link):
--   job_report_view() and job_report_sign().
--
-- Rollback: supabase/rollback/20261009160000_job_reports.down.sql.

------------------------------------------------------------- the settings

insert into public.setting_definitions
  (key, label, description, value_type, default_value, min_value, max_value, pattern, sort_order) values
  ('job_report_send', 'Send job reports',
   'When the client contacts at each site get the job reports: immediate, evening (one email a day per site) or manual.',
   'text', '"manual"', null, null, '^(immediate|evening|manual)$', 990),
  ('job_report_send_time', 'Evening job reports at',
   'The time the evening job report email goes out, on the company''s clock.',
   'time', '"18:00"', null, null, null, 991);

insert into public.template_settings (template_code, setting_key, value)
select v.template_code, 'job_report_send', to_jsonb(v.mode)
  from (values
    ('cleaning', 'evening'), ('garden', 'evening'), ('plumbing', 'immediate'), ('installation', 'immediate'),
    ('maintenance', 'evening'), ('security', 'evening'), ('pest_control', 'evening'), ('pool', 'evening'),
    ('delivery', 'evening'), ('generic', 'evening')
  ) as v(template_code, mode)
 where exists (select 1 from public.industry_templates it where it.code = v.template_code);

insert into public.company_settings (org_id, key, value)
select o.id, d.key, coalesce(
         (select ts.value from public.template_settings ts
           where ts.template_code = o.industries[1] and ts.setting_key = d.key),
         d.default_value)
  from public.organizations o
  cross join public.setting_definitions d
 where d.key in ('job_report_send', 'job_report_send_time')
on conflict (org_id, key) do nothing;

---------------------------------------------------------------- the table

create table public.job_reports (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  visit_id          uuid not null unique references public.visits(id) on delete cascade,
  store_id          uuid not null references public.stores(id) on delete cascade,
  expires_at        timestamptz not null default now() + interval '180 days',
  revoked_at        timestamptz,
  first_queued_at   timestamptz,
  last_queued_at    timestamptz,
  opened_at         timestamptz,
  signed_at         timestamptz,
  signed_name       text check (signed_name is null or length(btrim(signed_name)) between 1 and 120),
  -- The pen strokes as SVG path data only ("M12 40L13 41…" in a 600 x 200
  -- box), never markup, so nothing in it can run when it is drawn.
  signature_path    text check (signature_path is null or (length(signature_path) between 5 and 100000
                                                         and signature_path ~ '^[ML0-9 .,-]+$')),
  signed_ip         text,
  signed_user_agent text,
  created_at        timestamptz not null default now(),
  check ((signed_at is null) = (signed_name is null) and (signed_at is null) = (signature_path is null))
);

create index job_reports_org_idx on public.job_reports (org_id, created_at desc);
create index job_reports_store_idx on public.job_reports (store_id);

alter table public.job_reports enable row level security;

create policy job_reports_select on public.job_reports for select to authenticated
  using (org_id = (select public.current_org_id())
         and ((select public.has_permission('insights')) or (select public.has_permission('invoicing'))));

grant select on public.job_reports to authenticated;

-- The report for a finished job, made once. Internal.
create function public.ensure_job_report(p_visit_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v public.visits;
begin
  select * into v from public.visits where id = p_visit_id;
  if not found or v.status <> 'checked_out' then
    return null;
  end if;
  insert into public.job_reports (org_id, visit_id, store_id)
  values (v.org_id, v.id, v.store_id)
  on conflict (visit_id) do nothing;
  select id into v_id from public.job_reports where visit_id = p_visit_id;
  return v_id;
end;
$function$;

revoke all on function public.ensure_job_report(uuid) from public, anon, authenticated;

-- Queue reports to a site's contacts: one email per contact, listing the
-- given reports (all of one company and one site). Internal.
create function public.queue_job_report_emails(p_org uuid, p_store uuid, p_report_ids uuid[], p_template text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c record;
  n integer := 0;
  v_day date := (now() at time zone public.org_timezone(p_org))::date;
begin
  if coalesce(array_length(p_report_ids, 1), 0) = 0 then
    return 0;
  end if;
  for c in select sc.name, sc.email from public.site_contacts sc
            where sc.org_id = p_org and sc.store_id = p_store and sc.receives_reports and sc.email is not null
  loop
    perform public.queue_email(p_org, c.email, c.name, p_template,
                               jsonb_build_object('report_ids', to_jsonb(p_report_ids), 'day', v_day),
                               'job_report', p_store);
    n := n + 1;
  end loop;
  update public.job_reports
     set first_queued_at = coalesce(first_queued_at, now()), last_queued_at = now()
   where id = any(p_report_ids);
  return n;
end;
$function$;

revoke all on function public.queue_job_report_emails(uuid, uuid, uuid[], text) from public, anon, authenticated;

------------------------------------------------------------- automatic sends

-- Every 15 minutes. "immediate": each finished job of the last two days not
-- yet sent, as it finishes. "evening": once the company's clock passes the
-- send time, today's finished jobs not yet sent, one email per site.
-- Companies that cannot write (read only) or send manually are skipped.
create function public.queue_job_reports()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  o record;
  s record;
  v_mode text;
  v_tz text;
  v_time time;
  v_today date;
  n integer := 0;
begin
  for o in select org.id from public.organizations org
            where not exists (select 1 from public.company_account a
                               where a.org_id = org.id and a.status in ('read_only', 'cancelled'))
  loop
    v_mode := coalesce(public.org_setting(o.id, 'job_report_send') #>> '{}', 'manual');
    continue when v_mode not in ('immediate', 'evening');
    v_tz := public.org_timezone(o.id);
    v_today := (now() at time zone v_tz)::date;
    v_time := coalesce((public.org_setting(o.id, 'job_report_send_time') #>> '{}')::time, time '18:00');
    continue when v_mode = 'evening' and (now() at time zone v_tz)::time < v_time;
    for s in
      select v.store_id, array_agg(public.ensure_job_report(v.id) order by v.checkin_at) as ids
        from public.visits v
       where v.org_id = o.id and v.status = 'checked_out'
         and v.checkout_at > now() - interval '2 days'
         and (v_mode = 'immediate' or (v.checkin_at at time zone v_tz)::date = v_today)
         and not exists (select 1 from public.job_reports jr where jr.visit_id = v.id and jr.first_queued_at is not null)
         and exists (select 1 from public.site_contacts sc
                      where sc.store_id = v.store_id and sc.receives_reports and sc.email is not null)
       group by v.store_id
    loop
      n := n + public.queue_job_report_emails(o.id, s.store_id, s.ids,
                                              case when v_mode = 'immediate' then 'job_report' else 'job_reports_day' end);
    end loop;
  end loop;
  return n;
end;
$function$;

revoke all on function public.queue_job_reports() from public, anon, authenticated;

select cron.schedule('job-reports', '*/15 * * * *', 'select public.queue_job_reports()');

------------------------------------------------------------- in the app

-- "Send to the client now", from a job: to every contact at its site who gets
-- reports, whatever the company's setting. The number of emails queued.
create function public.send_job_report(p_visit_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v public.visits;
  v_id uuid;
begin
  perform public.require_writable();
  if not (public.has_permission('insights') or public.has_permission('invoicing')) then
    raise exception 'Only someone who reads reports or invoices can send a job''s report.' using errcode = '42501';
  end if;
  select * into v from public.visits where id = p_visit_id and org_id = public.current_org_id();
  if not found then
    raise exception 'That job was not found.' using errcode = 'P0002';
  end if;
  if v.status <> 'checked_out' then
    raise exception 'The job is not finished yet.' using errcode = '22023';
  end if;
  v_id := public.ensure_job_report(p_visit_id);
  return public.queue_job_report_emails(v.org_id, v.store_id, array[v_id], 'job_report');
end;
$function$;

revoke all on function public.send_job_report(uuid) from public, anon;
grant execute on function public.send_job_report(uuid) to authenticated;

-- The report's id for a finished job of the caller's company, made if need
-- be; the server turns it into the link to copy.
create function public.job_report_for_visit(p_visit_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not (public.has_permission('insights') or public.has_permission('invoicing')) then
    raise exception 'Only someone who reads reports or invoices can open a job''s report.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.visits where id = p_visit_id and org_id = public.current_org_id()
                   and status = 'checked_out') then
    raise exception 'That finished job was not found.' using errcode = 'P0002';
  end if;
  return public.ensure_job_report(p_visit_id);
end;
$function$;

revoke all on function public.job_report_for_visit(uuid) from public, anon;
grant execute on function public.job_report_for_visit(uuid) to authenticated;

------------------------------------------------------------- for the server

-- Everything the client's page shows, or null when the report is unknown,
-- expired or withdrawn. Service role only: the server checked the link first.
create function public.job_report_view(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  r public.job_reports;
  v public.visits;
  v_tz text;
  v_forms boolean;
begin
  select * into r from public.job_reports where id = p_report_id;
  if not found or r.revoked_at is not null or r.expires_at < now() then
    return null;
  end if;
  select * into v from public.visits where id = r.visit_id;
  v_tz := public.org_timezone(r.org_id);
  return jsonb_build_object(
    'report_id', r.id,
    'timezone', v_tz,
    'company', (select jsonb_build_object('name', coalesce(nullif(btrim(o.legal_name), ''), o.name), 'logo_path', o.logo_path,
                                          'email', o.support_email, 'phone', o.phone)
                  from public.organizations o where o.id = r.org_id),
    'job_word', coalesce((select ct.singular from public.company_terminology ct
                           where ct.org_id = r.org_id and ct.key = 'job'), 'Job'),
    'staff_word', coalesce((select ct.singular from public.company_terminology ct
                             where ct.org_id = r.org_id and ct.key = 'staff'), 'Staff member'),
    'site', (select jsonb_build_object('name', s.name,
                                       'address', nullif(concat_ws(', ', nullif(btrim(s.address), ''), nullif(btrim(s.city), '')), ''),
                                       'lat', s.lat, 'lng', s.lng)
               from public.stores s where s.id = r.store_id),
    'staff_name', (select p.full_name from public.profiles p where p.id = v.rep_id),
    'day', (v.checkin_at at time zone v_tz)::date,
    'checkin_at', v.checkin_at,
    'checkout_at', v.checkout_at,
    'minutes', round(extract(epoch from v.checkout_at - v.checkin_at) / 60)::integer,
    'on_site', case when v.checkin_distance_from_store_m is null then null
                    else v.checkin_distance_from_store_m <= (select s.geofence_radius_m from public.stores s where s.id = r.store_id) end,
    'checklists', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', ft.name,
               'answers', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'label', ff.label, 'type', ff.field_type,
                          'text', fr.value_text, 'number', fr.value_number, 'yes', fr.value_boolean,
                          'photo_path', (select ph.storage_path from public.photos ph where ph.id = fr.photo_id))
                        order by ff.sort_order)
                   from public.form_responses fr
                   join public.form_fields ff on ff.id = fr.form_field_id
                  where fr.form_submission_id = fs.id), '[]'::jsonb))
             order by fs.submitted_at)
        from public.form_submissions fs
        join public.form_templates ft on ft.id = fs.form_template_id
       where fs.visit_id = v.id), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('path', ph.storage_path, 'taken_at', ph.taken_at)
                                         order by ph.taken_at nulls last, ph.created_at)
                          from public.photos ph where ph.visit_id = v.id), '[]'::jsonb),
    'signed', case when r.signed_at is null then null
                   else jsonb_build_object('name', r.signed_name, 'at', r.signed_at, 'path', r.signature_path) end
  );
end;
$function$;

revoke all on function public.job_report_view(uuid) from public, anon, authenticated;
grant execute on function public.job_report_view(uuid) to service_role;

-- The client opened the report (first time only). Service role only.
create function public.job_report_opened(p_report_id uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.job_reports set opened_at = now() where id = p_report_id and opened_at is null;
$function$;

revoke all on function public.job_report_opened(uuid) from public, anon, authenticated;
grant execute on function public.job_report_opened(uuid) to service_role;

-- The client signs. Once only; not when expired or withdrawn. Service role only.
create function public.job_report_sign(p_report_id uuid, p_name text, p_signature_path text,
                                       p_ip text default null, p_user_agent text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Type your name to sign.' using errcode = '22023';
  end if;
  if p_signature_path is null or length(p_signature_path) not between 5 and 100000
     or p_signature_path !~ '^[ML0-9 .,-]+$' then
    raise exception 'The signature could not be read. Sign again.' using errcode = '22023';
  end if;
  update public.job_reports
     set signed_at = now(), signed_name = btrim(p_name), signature_path = p_signature_path,
         signed_ip = left(p_ip, 64), signed_user_agent = left(p_user_agent, 300)
   where id = p_report_id and signed_at is null and revoked_at is null and expires_at > now();
  return found;
end;
$function$;

revoke all on function public.job_report_sign(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.job_report_sign(uuid, text, text, text, text) to service_role;

------------------------------------------------------------- registration

insert into public.module_assignments (kind, name, module_code) values
  ('table', 'job_reports', 'core'),
  ('function', 'send_job_report', 'core'),
  ('function', 'job_report_for_visit', 'core');
