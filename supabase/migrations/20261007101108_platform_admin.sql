-- The platform operator: who runs the service, as opposed to who runs a company.
--
-- Until now there was one company and its administrator was, in effect, the
-- operator too; anything cross-company was done with the service role by hand.
-- Selling to a second company needs a place to see all of them — and that
-- place must not be reachable by a company's own administrator, whose `admin`
-- permission is, and must stay, scoped to their own organisation.
--
-- `platform_admins` is the list. It has RLS on and **no** policies, and every
-- privilege is revoked from `anon` and `authenticated`: nobody can read or join
-- it through the API, and nobody can add themselves. Rows are added with the
-- service role or a database session only. Membership is asked through
-- `is_platform_admin()`, which answers for the caller and nobody else.
--
-- `platform_audit_log` records what the operator does to a company — switching
-- modules, changing a plan, impersonating for support (the requirements, §6).
-- Nothing writes to it yet; it exists so the first action that needs it does
-- not ship without it. Same lock: no API access at all; written by the server
-- with the service role.
--
-- Neither table has `org_id`, by design: they sit above companies. Both are
-- listed as platform tables in `supabase/tests/tenant_isolation.sql`.

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from anon, authenticated;

comment on table public.platform_admins is
  'Platform operators. No API access; managed with the service role. Ask through is_platform_admin().';

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  )
$function$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

comment on function public.is_platform_admin is
  'Whether the caller is a platform operator. Answers only for the caller.';

create table if not exists public.platform_audit_log (
  id            bigint generated always as identity primary key,
  actor_id      uuid not null references auth.users(id),
  action        text not null,
  target_org_id uuid references public.organizations(id) on delete set null,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists platform_audit_log_target_idx
  on public.platform_audit_log (target_org_id, created_at desc);

alter table public.platform_audit_log enable row level security;
revoke all on table public.platform_audit_log from anon, authenticated;

comment on table public.platform_audit_log is
  'Every platform-operator action on a company. No API access; written by the server with the service role.';
