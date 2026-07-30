-- `territory_reps` was the one table in the territory structure with no proof
-- that the rows it points at live in the same organisation.
--
-- `territories` gets `territories_enforce_shape` and `stores` gets
-- `stores_enforce_territory`; this table got neither, and its insert policy only
-- checks the `org_id` *supplied in the row*:
--
--   org_id = current_org_id() and current_role() = 'manager'
--
-- So a manager could insert coverage whose `org_id` is their own — passing RLS —
-- while `territory_id` or `rep_id` pointed into another tenant. Confirmed by
-- exploiting it inside a rolled-back transaction: a row with org A's `org_id`
-- and org B's territory was accepted. Any query joining
-- `territory_reps → territories` then crosses the tenancy line.
--
-- Reaching it needs a foreign uuid, which RLS does not hand out — the same
-- "harder to reach, but it is the boundary of the entire multi-tenant model"
-- as the `profiles.org_id` hole in docs/SECURITY-AUDIT.md, which was closed on
-- the same reasoning. A check constraint cannot see another row, so this is a
-- trigger.
create or replace function public.territory_reps_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_territory_org uuid;
  v_rep_org uuid;
begin
  -- Definer so the check reads the real row rather than the caller's RLS view
  -- of it: a foreign territory is invisible to a select, and "not visible" must
  -- not be allowed to look the same as "belongs to us".
  select org_id into v_territory_org
    from public.territories where id = new.territory_id;
  if v_territory_org is null then
    raise exception 'That territory does not exist.';
  end if;
  if v_territory_org <> new.org_id then
    raise exception 'A territory can only be covered by reps in its own organisation.';
  end if;

  select org_id into v_rep_org
    from public.profiles where id = new.rep_id;
  if v_rep_org is null then
    raise exception 'That rep does not exist.';
  end if;
  if v_rep_org <> new.org_id then
    raise exception 'A rep can only cover territories in their own organisation.';
  end if;

  return new;
end;
$$;

create trigger territory_reps_org_shape
before insert or update of org_id, territory_id, rep_id on public.territory_reps
for each row execute function public.territory_reps_enforce_org();
