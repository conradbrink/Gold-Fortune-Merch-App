-- Undo 20261011090000_close_company: reopen anything closed (its old status
-- back), restore the four helpers as they were (20260727203059 and
-- 20260826152011), drop the two functions and the columns.

update public.company_account
   set status = coalesce(status_before_close, 'trial')
 where closed_at is not null;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select org_id from public.profiles
   where id = auth.uid() and is_active
$$;

create or replace function public."current_role"()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select role from public.profiles
   where id = auth.uid() and is_active
$$;

create or replace function public.has_permission(p_code text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.profile_permissions pp
      join public.profiles p on p.id = pp.profile_id
     where pp.profile_id = auth.uid()
       and p.is_active
       and pp.permission_code in (p_code, 'admin')
  )
$$;

create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(pp.permission_code order by pp.permission_code), '{}')
    from public.profile_permissions pp
    join public.profiles p on p.id = pp.profile_id
   where pp.profile_id = auth.uid() and p.is_active
$$;

drop function if exists public.platform_set_company_closed(uuid, boolean, uuid, text);
drop function if exists public.my_company_closed();

alter table public.company_account
  drop column if exists closed_at,
  drop column if exists closed_by,
  drop column if exists closed_reason,
  drop column if exists status_before_close;
