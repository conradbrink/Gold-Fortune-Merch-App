-- is_active was cosmetic: Supabase auth does not know about the column, and
-- these helpers ignored it, so a "deactivated" rep could still sign in to the
-- mobile app and RLS still handed them their org's data.
--
-- Enforcing it here rather than in the apps is deliberate — every policy in the
-- schema already funnels through these two functions, so one change covers the
-- web dashboard, the Flutter app and any future client at once. A deactivated
-- user now gets null from both, and `org_id = null` is never true, so every
-- policy denies.
--
-- Both stay SECURITY DEFINER (they must read profiles regardless of the
-- caller's own policies) with search_path pinned.
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
