-- A warehouse clerk may create a store, and nothing more than create it.
--
-- The order-capture screen offers to add a store the search cannot find,
-- because the person on the phone taking the order is a warehouse clerk and
-- the shop on the line may be new. `stores_insert` was manager-only, so the
-- offer worked for a manager and produced an RLS refusal for the exact person
-- the screen was built for.
--
-- Insert only, deliberately. `stores_update` and `stores_delete` stay
-- manager-only: creating a record for a shop that just rang is data entry,
-- while renaming or removing a store rewrites history every past order and
-- visit points at. The clerk who typos a name asks a manager, which is the
-- right amount of friction for an edit that touches everything.
--
-- Verified in a rolled-back transaction before applying: a warehouse clerk's
-- insert succeeds, the same clerk's update is silently filtered by the
-- untouched manager-only policy, and a rep's insert is still refused outright.

drop policy if exists stores_insert on public.stores;
create policy stores_insert on public.stores
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );
