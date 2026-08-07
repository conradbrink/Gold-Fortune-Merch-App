-- Moving stock between places we own.
--
-- A transfer is two events, not one. Stock leaves the source and becomes
-- in_transit *at the destination*, and some time later — minutes for a van
-- being loaded, days for a second warehouse — it is received. In between, it is
-- nowhere anybody can sell it, which is the honest description of a lorry on a
-- road.
--
-- Holding in_transit at the destination rather than the source is the choice
-- that makes "what is coming to me" answerable without a second query, and it
-- costs nothing: `qty_on_hand` excludes in_transit, so the destination is not
-- credited with stock that has not arrived.
--
-- ---------------------------------------------------------------- deadlocks
--
-- Two transfers between the same pair of locations in opposite directions is
-- the textbook deadlock, and it will happen the first week two vans are
-- reloading from each other. Both RPCs take a `pg_advisory_xact_lock` on the
-- *sorted* pair of location ids before touching either, so the two transactions
-- queue instead of grabbing each other's rows. The same technique
-- serialize_territory_reparenting uses, for the same reason.
--
-- ------------------------------------------------------------- shortfalls
--
-- Receiving less than was sent is a real event with several causes, so the line
-- carries a reason and the difference is written off as `transfer_loss` rather
-- than left in in_transit for ever. A transfer that never reconciles is how
-- stock quietly disappears from a system that looks like it is working.

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  transfer_number text not null,

  from_location_id uuid not null references public.stock_locations(id) on delete restrict,
  to_location_id uuid not null references public.stock_locations(id) on delete restrict,

  status text not null default 'draft',
  notes text,

  dispatched_at timestamptz,
  dispatched_by uuid references public.profiles(id) on delete set null,
  received_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  cancel_reason text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stock_transfers is
  'Stock moving between two of our own locations. In transit is held at the destination, so "what is coming to me" is one query.';

alter table public.stock_transfers drop constraint if exists stock_transfers_status_check;
alter table public.stock_transfers add constraint stock_transfers_status_check
  check (status in ('draft', 'in_transit', 'received', 'cancelled'));

-- Stock cannot be transferred to where it already is.
alter table public.stock_transfers drop constraint if exists stock_transfers_different_places;
alter table public.stock_transfers add constraint stock_transfers_different_places
  check (from_location_id <> to_location_id);

alter table public.stock_transfers drop constraint if exists stock_transfers_cancel_reason;
alter table public.stock_transfers add constraint stock_transfers_cancel_reason
  check (status <> 'cancelled' or cancel_reason is not null);

create unique index if not exists stock_transfers_org_number_key
  on public.stock_transfers (org_id, transfer_number);
create index if not exists stock_transfers_org_status_idx
  on public.stock_transfers (org_id, status, created_at desc);
create index if not exists stock_transfers_from_idx on public.stock_transfers (from_location_id);
create index if not exists stock_transfers_to_idx on public.stock_transfers (to_location_id);

drop trigger if exists stock_transfers_set_updated_at on public.stock_transfers;
create trigger stock_transfers_set_updated_at
  before update on public.stock_transfers
  for each row execute function public.set_updated_at();

create table if not exists public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.product_batches(id) on delete restrict,

  qty_sent integer not null,
  qty_received integer,
  variance_reason text,
  notes text,

  created_at timestamptz not null default now()
);

alter table public.stock_transfer_lines drop constraint if exists stock_transfer_lines_qty_check;
alter table public.stock_transfer_lines add constraint stock_transfer_lines_qty_check
  check (
    qty_sent > 0
    and (qty_received is null or (qty_received >= 0 and qty_received <= qty_sent))
  );

alter table public.stock_transfer_lines drop constraint if exists stock_transfer_lines_variance_reason_check;
alter table public.stock_transfer_lines add constraint stock_transfer_lines_variance_reason_check
  check (
    variance_reason is null
    or variance_reason in ('short_shipped', 'damaged_in_transit', 'lost', 'miscount', 'other')
  );

-- A shortfall has to be explained. Receiving fewer than were sent and saying
-- nothing is how a transfer becomes an unexplained loss six weeks later.
alter table public.stock_transfer_lines drop constraint if exists stock_transfer_lines_variance_explained;
alter table public.stock_transfer_lines add constraint stock_transfer_lines_variance_explained
  check (qty_received is null or qty_received = qty_sent or variance_reason is not null);

create index if not exists stock_transfer_lines_parent_idx
  on public.stock_transfer_lines (transfer_id);
create index if not exists stock_transfer_lines_product_idx
  on public.stock_transfer_lines (org_id, product_id);

/**
 * Lines belong to their transfer's organisation, and can only be edited while
 * the transfer is a draft — once it has been dispatched the line describes
 * movements that have already been posted.
 */
create or replace function public.stock_transfer_lines_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status text;
begin
  select org_id, status into v_org, v_status
  from public.stock_transfers where id = new.transfer_id;

  if v_org is distinct from new.org_id then
    raise exception 'That transfer belongs to another organisation.' using errcode = '42501';
  end if;

  -- The receive RPC writes qty_received on a dispatched transfer, and runs as
  -- definer; a signed-in user has no update privilege on those columns anyway.
  if v_status = 'draft' or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  raise exception 'Transfer % has already been dispatched; its lines cannot be changed.',
    (select transfer_number from public.stock_transfers where id = new.transfer_id)
    using errcode = '42501';
end;
$$;

drop trigger if exists stock_transfer_lines_org_guard on public.stock_transfer_lines;
create trigger stock_transfer_lines_org_guard
  before insert or update on public.stock_transfer_lines
  for each row execute function public.stock_transfer_lines_enforce_org();

-- ---------------------------------------------------------------------- RLS

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;

drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stock_transfers_insert on public.stock_transfers;
create policy stock_transfers_insert on public.stock_transfers
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  );

drop policy if exists stock_transfers_update on public.stock_transfers;
create policy stock_transfers_update on public.stock_transfers
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  ) with check (org_id = (select public.current_org_id()));

drop policy if exists stock_transfers_delete on public.stock_transfers;
create policy stock_transfers_delete on public.stock_transfers
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  );

drop policy if exists stock_transfer_lines_select on public.stock_transfer_lines;
create policy stock_transfer_lines_select on public.stock_transfer_lines
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stock_transfer_lines_insert on public.stock_transfer_lines;
create policy stock_transfer_lines_insert on public.stock_transfer_lines
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stock_transfer_lines_update on public.stock_transfer_lines;
create policy stock_transfer_lines_update on public.stock_transfer_lines
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  ) with check (org_id = (select public.current_org_id()));

drop policy if exists stock_transfer_lines_delete on public.stock_transfer_lines;
create policy stock_transfer_lines_delete on public.stock_transfer_lines
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- Status and the two timestamp pairs are server-controlled, as everywhere else
-- in this module.
revoke update on public.stock_transfers from authenticated, anon;
grant update (from_location_id, to_location_id, notes, updated_at)
  on public.stock_transfers to authenticated;

revoke update on public.stock_transfer_lines from authenticated, anon;
grant update (product_id, batch_id, qty_sent, notes)
  on public.stock_transfer_lines to authenticated;

-- ----------------------------------------------------------------- the RPCs

/**
 * Sends a draft transfer on its way: available at the source becomes in_transit
 * at the destination.
 */
create or replace function public.stock_transfer_dispatch(p_transfer_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_t public.stock_transfers;
  v_line record;
  v_a uuid;
  v_b uuid;
  v_total integer := 0;
  v_lines integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can send a transfer.' using errcode = '42501';
  end if;

  select * into v_t from public.stock_transfers where id = p_transfer_id and org_id = v_org;
  if not found then
    raise exception 'That transfer does not exist.' using errcode = 'P0002';
  end if;
  if v_t.status <> 'draft' then
    raise exception 'Transfer % is already %.', v_t.transfer_number, v_t.status
      using errcode = '42501';
  end if;

  -- Sorted pair, so two transfers between the same places in opposite
  -- directions queue rather than deadlock.
  v_a := least(v_t.from_location_id, v_t.to_location_id);
  v_b := greatest(v_t.from_location_id, v_t.to_location_id);
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_a::text));
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_b::text));

  if not exists (select 1 from public.stock_transfer_lines where transfer_id = v_t.id) then
    raise exception 'Transfer % has no lines.', v_t.transfer_number using errcode = '42501';
  end if;

  for v_line in
    select * from public.stock_transfer_lines
    where transfer_id = v_t.id
    order by product_id, batch_id nulls first, id
  loop
    insert into public.stock_movements (
      org_id, product_id, batch_id, qty,
      from_location_id, from_bucket, to_location_id, to_bucket,
      reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id)
    values (
      v_org, v_line.product_id, v_line.batch_id, v_line.qty_sent,
      v_t.from_location_id, 'available', v_t.to_location_id, 'in_transit',
      'transfer_out', v_t.transfer_number,
      'transfer', v_t.id, v_line.id, auth.uid());

    v_total := v_total + v_line.qty_sent;
    v_lines := v_lines + 1;
  end loop;

  update public.stock_transfers
     set status = 'in_transit', dispatched_at = now(), dispatched_by = auth.uid()
   where id = v_t.id;

  return jsonb_build_object(
    'transfer_id', v_t.id, 'transfer_number', v_t.transfer_number,
    'status', 'in_transit', 'lines', v_lines, 'units', v_total);
end;
$$;

comment on function public.stock_transfer_dispatch(uuid) is
  'Sends a draft transfer: available at the source becomes in_transit at the destination.';

/**
 * Receives a transfer. p_lines is [{"line_id": uuid, "qty_received": int,
 * "variance_reason": text}]; omit a line and it is received in full.
 *
 * Anything short is written off as `transfer_loss` in the same transaction, so
 * the in_transit bucket always empties and a transfer cannot leave stock
 * stranded between two places.
 */
create or replace function public.stock_transfer_receive(
  p_transfer_id uuid,
  p_lines jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_t public.stock_transfers;
  v_line record;
  v_got integer;
  v_lost integer;
  v_reason text;
  v_a uuid;
  v_b uuid;
  v_received integer := 0;
  v_written_off integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can receive a transfer.' using errcode = '42501';
  end if;

  select * into v_t from public.stock_transfers where id = p_transfer_id and org_id = v_org;
  if not found then
    raise exception 'That transfer does not exist.' using errcode = 'P0002';
  end if;
  if v_t.status <> 'in_transit' then
    raise exception 'Transfer % is %, not on its way.', v_t.transfer_number, v_t.status
      using errcode = '42501';
  end if;

  v_a := least(v_t.from_location_id, v_t.to_location_id);
  v_b := greatest(v_t.from_location_id, v_t.to_location_id);
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_a::text));
  perform pg_advisory_xact_lock(hashtext('stock_transfer'), hashtext(v_b::text));

  for v_line in
    select * from public.stock_transfer_lines
    where transfer_id = v_t.id
    order by product_id, batch_id nulls first, id
  loop
    v_got := coalesce(
      (select (e->>'qty_received')::integer
       from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
       where (e->>'line_id')::uuid = v_line.id),
      v_line.qty_sent);
    v_reason := (
      select nullif(btrim(coalesce(e->>'variance_reason', '')), '')
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
      where (e->>'line_id')::uuid = v_line.id);

    if v_got < 0 or v_got > v_line.qty_sent then
      raise exception 'Cannot receive % of a line of %.', v_got, v_line.qty_sent
        using errcode = '23514';
    end if;
    v_lost := v_line.qty_sent - v_got;

    if v_lost > 0 and v_reason is null then
      raise exception
        'Short by % on one line. Say why: short_shipped, damaged_in_transit, lost, miscount or other.',
        v_lost using errcode = '22023';
    end if;

    if v_got > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket, to_location_id, to_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_got,
        v_t.to_location_id, 'in_transit', v_t.to_location_id, 'available',
        'transfer_in', v_t.transfer_number,
        'transfer', v_t.id, v_line.id, auth.uid());
    end if;

    -- The difference leaves the system with a reason attached. Left in
    -- in_transit it would sit there for ever, counted nowhere and owned by
    -- nobody.
    if v_lost > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket,
        reason, reference, source_doc_type, source_doc_id, source_line_id, actor_id, note)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_lost,
        v_t.to_location_id, 'in_transit',
        'transfer_loss', v_t.transfer_number,
        'transfer', v_t.id, v_line.id, auth.uid(), v_reason);
    end if;

    update public.stock_transfer_lines
       set qty_received = v_got, variance_reason = v_reason
     where id = v_line.id;

    v_received := v_received + v_got;
    v_written_off := v_written_off + v_lost;
  end loop;

  update public.stock_transfers
     set status = 'received', received_at = now(), received_by = auth.uid()
   where id = v_t.id;

  return jsonb_build_object(
    'transfer_id', v_t.id, 'transfer_number', v_t.transfer_number,
    'status', 'received', 'units_received', v_received,
    'units_written_off', v_written_off);
end;
$$;

comment on function public.stock_transfer_receive(uuid, jsonb) is
  'Receives a transfer at the destination. Any shortfall is written off as transfer_loss with a reason.';

revoke all on function public.stock_transfer_dispatch(uuid) from public, anon;
grant execute on function public.stock_transfer_dispatch(uuid) to authenticated;
revoke all on function public.stock_transfer_receive(uuid, jsonb) from public, anon;
grant execute on function public.stock_transfer_receive(uuid, jsonb) to authenticated;
revoke all on function public.stock_transfer_lines_enforce_org() from public, anon, authenticated;
