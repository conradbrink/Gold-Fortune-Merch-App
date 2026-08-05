-- The rep app's order lines were refused by a privilege check, not a policy.
--
-- Every order taken on a phone since 1.1.3 reached the warehouse with no lines
-- on it: SO-000006 through SO-000009, all `rep_app`, all empty. The header
-- inserts, the lines do not, and the outbox retries until it gives up.
--
-- The app upserts its lines on `client_generated_id` so a half-applied batch
-- can be completed rather than duplicated. PostgREST compiles an upsert into
-- `insert ... on conflict do update set <every column in the payload>`, and
-- Postgres then requires UPDATE privilege on all of them — including
-- `org_id`, `order_id`, `product_id` and `client_generated_id`, which the
-- orders migration deliberately withheld. The write never reached RLS: it
-- failed the column ACL first, as 42501.
--
-- Granting those four columns re-opens something the column grants were
-- closing: with UPDATE on `order_id` and a WITH CHECK that only asserted the
-- org, a rep could move a line off their own order and onto somebody else's.
-- The USING clause always asked the right question — is this line's order new,
-- and mine? — and WITH CHECK now asks it of the row being written, so the
-- destination is tested as well as the source.
--
-- `product_id` and `client_generated_id` are a rep correcting their own order
-- while it is still `new`, which they can already do by quantity.
--
-- Verified in a rolled-back transaction against production before applying,
-- with this exact policy in place: the rep app's upsert succeeds as Atang; the
-- same rep moving that line onto another rep's order is refused 42501; and a
-- manager still prices a line on a `new` order. The fulfilment RPCs are
-- unaffected — they are definer-owned and never saw these grants.
--
-- This unblocks orders taken from now on, on handsets already in the field and
-- with no new APK. It does not recover the four orders whose lines are still
-- stalled in an outbox on a rep's phone; that needs the app-side fix.

grant update (org_id, order_id, product_id, client_generated_id)
  on public.order_lines to authenticated;

drop policy if exists order_lines_update on public.order_lines;
create policy order_lines_update on public.order_lines
  for update using (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = order_lines.order_id
        and o.status = 'new'
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  ) with check (
    org_id = (select public.current_org_id())
    and exists (
      select 1 from public.orders o
      where o.id = order_lines.order_id
        and o.status = 'new'
        and ((select public."current_role"()) in ('manager', 'warehouse')
             or o.rep_id = (select auth.uid()))
    )
  );
