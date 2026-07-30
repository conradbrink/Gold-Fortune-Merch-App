-- The policies in create_files were mutually recursive and Postgres refused
-- them outright ("infinite recursion detected in policy for relation files").
--
-- A subquery inside a policy is itself subject to the referenced table's RLS.
-- So files_select read file_reps, which triggered file_reps_select, which read
-- files, which triggered files_select — forever. The design intent was right;
-- the mechanism was not.
--
-- The entitlement lookup now lives in a security-definer function, which runs
-- as the owner and therefore does not re-enter RLS. It still takes the
-- audience as an argument rather than reading it from `files`, because looking
-- it up would recreate the same cycle.
create or replace function public.can_see_file(p_file_id uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_audience
    when 'everyone' then true
    when 'reps' then exists (
      select 1 from file_reps fr
      where fr.file_id = p_file_id and fr.rep_id = auth.uid()
    )
    -- Reps inherit chain access from the stores they cover, so moving a store
    -- between reps moves the planogram with it.
    when 'groups' then exists (
      select 1 from file_groups fg
      join stores s on s.store_group_id = fg.store_group_id
      join store_assignments sa on sa.store_id = s.id
      where fg.file_id = p_file_id and sa.rep_id = auth.uid()
    )
    else false
  end;
$$;

comment on function public.can_see_file is
  'Entitlement for one file. Security definer so it can be used inside the files RLS policy without recursing through file_reps/file_groups.';

revoke execute on function public.can_see_file(uuid, text) from public, anon;
grant execute on function public.can_see_file(uuid, text) to authenticated;

drop policy if exists files_select on public.files;
create policy files_select on public.files
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public."current_role"()) = 'manager'
      or public.can_see_file(id, audience)
    )
  );

-- Is this file in my org? Also security definer, for the same reason: the
-- write policies on the join tables need to look at `files` without dragging
-- files_select back into the cycle.
create or replace function public.file_in_my_org(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from files f
    where f.id = p_file_id and f.org_id = public.current_org_id()
  );
$$;

revoke execute on function public.file_in_my_org(uuid) from public, anon;
grant execute on function public.file_in_my_org(uuid) to authenticated;

-- The join tables no longer reference `files` through RLS at all.
--
-- A rep can read their own membership rows and nothing else; the rows carry no
-- content, and a rep learning that some file id is shared with them is
-- meaningless without the file itself, which files_select still governs.
drop policy if exists file_reps_select on public.file_reps;
create policy file_reps_select on public.file_reps
  for select using (
    (select public."current_role"()) = 'manager'
    or rep_id = (select auth.uid())
  );

drop policy if exists file_reps_write on public.file_reps;
create policy file_reps_write on public.file_reps
  for all using (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  ) with check (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  );

drop policy if exists file_groups_select on public.file_groups;
create policy file_groups_select on public.file_groups
  for select using (
    -- Chain tags are not rep-specific, so any org member may read them; the
    -- file itself is still gated by files_select.
    (select public.current_org_id()) is not null
  );

drop policy if exists file_groups_write on public.file_groups;
create policy file_groups_write on public.file_groups
  for all using (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  ) with check (
    (select public."current_role"()) = 'manager' and public.file_in_my_org(file_id)
  );
