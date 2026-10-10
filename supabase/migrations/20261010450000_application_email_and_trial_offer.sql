-- Two emails a new customer should hear from Tickd (owner, 10 Oct 2026):
--
-- 1. A founding applicant gets "we've got your application". The application
--    had no email address, only a WhatsApp number, so there was nobody to write
--    to: founding_applications gets an `email` (null for any earlier row).
-- 2. A company on its free days gets the offer to sign up fully, once, 45 days
--    after the trial began (owner: "45 days after the trial send them the offer
--    to sign up fully on email"). `trial_offer_day` is a platform setting (45)
--    so the owner can change it. queue_trial_offers() runs daily, picks every
--    company still on its trial that is at least that old, and queues one
--    email to its administrator through the outbox; trial_offers remembers
--    that it did, so it is once. A company the operator created has no account
--    row at all (it is on its free days by arrangement: this is a founding
--    member), so it counts too, from the day its company was made; Gold
--    Fortune (exempt), paid companies, and companies whose trial is over
--    (read only) are never asked.
--
-- The welcome email (sent when a company is created) needs nothing here: it
-- goes through queue_email like the others.
--
-- Rollback: supabase/rollback/20261010450000_application_email_and_trial_offer.down.sql.

alter table public.founding_applications
  add column email text
    check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

insert into public.platform_settings (key, value, description)
values ('trial_offer_day', '45', 'Days after a trial begins when its administrator is emailed the offer to sign up fully, once.')
on conflict (key) do nothing;

create table public.trial_offers (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  to_address text not null,
  queued_at  timestamptz not null default now()
);

alter table public.trial_offers enable row level security;
revoke all on public.trial_offers from public, anon, authenticated;

insert into public.module_assignments (kind, name, module_code) values ('table', 'trial_offers', 'core');

-- Queues the offer to each company that is due it. Returns how many.
create function public.queue_trial_offers()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raw text := (select value #>> '{}' from public.platform_settings where key = 'trial_offer_day');
  -- A setting that is not a whole number of days is 45, not an error that stops the daily job.
  v_day integer := case when v_raw ~ '^[0-9]{1,4}$' then v_raw::integer else 45 end;
  a record;
  v_to record;
  n integer := 0;
begin
  for a in
    select o.id as org_id, ca.trial_ends_at, o.name
      from public.organizations o
      left join public.company_account ca on ca.org_id = o.id
     where (ca.org_id is null or ca.status = 'trial')
       and coalesce(ca.created_at, o.created_at) <= now() - make_interval(days => v_day)
       and (ca.trial_ends_at is null or ca.trial_ends_at > now())
       and not exists (select 1 from public.trial_offers t where t.org_id = o.id)
  loop
    -- The administrator who set the company up: the oldest active login holding
    -- the admin permission, with a real email (not a phone login).
    select lower(e.email) as email, p.full_name into v_to
      from public.profiles p
      left join auth.users u on u.id = p.id
      cross join lateral (select coalesce(nullif(btrim(p.email), ''), u.email) as email) e
     where p.org_id = a.org_id and p.is_active and e.email is not null
       and e.email !~* '@staff\.tickd\.co\.za$'
       and exists (select 1 from public.profile_permissions pp where pp.profile_id = p.id and pp.permission_code = 'admin')
     order by p.created_at, p.id
     limit 1;
    if v_to.email is null then
      continue;
    end if;
    insert into public.trial_offers (org_id, to_address) values (a.org_id, v_to.email) on conflict do nothing;
    if not found then
      continue;
    end if;
    perform public.queue_email(
      a.org_id, v_to.email, v_to.full_name, 'trial_offer',
      jsonb_build_object(
        'first_name', split_part(btrim(coalesce(v_to.full_name, '')), ' ', 1),
        'company_name', a.name,
        'trial_ends_at', a.trial_ends_at,
        'days_left', case when a.trial_ends_at is null then null else greatest(0, (a.trial_ends_at::date - current_date)) end),
      'trial_offer', a.org_id);
    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke all on function public.queue_trial_offers() from public, anon, authenticated;

select cron.schedule('trial-offers', '0 7 * * *', 'select public.queue_trial_offers()');
