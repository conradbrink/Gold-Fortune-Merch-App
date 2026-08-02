-- Goods received notes: the only way stock enters the system.
--
-- Opening stock, a supplier delivery and a customer return are the same event
-- as far as the ledger is concerned — quantity arrives from outside — so they
-- are one table with a `receipt_type`, not three. The differences are which
-- fields are required, and those are check constraints.
--
-- ------------------------------------------------------ draft, then posted
--
-- A receipt is keyed as a draft and nothing moves. Posting is the moment stock
-- exists, and it is a single RPC that either lands completely or not at all.
-- The alternative — incrementing stock as each line is typed — makes a
-- half-entered delivery indistinguishable from a finished one, and there is no
-- moment at which the clerk can compare the note in their hand to the screen.
--
-- ------------------------------------------------------------ pack sizes
--
-- A delivery arrives in shrinks or cases; the ledger counts base sellable
-- units. The multiplier used is written onto the line at post time as
-- `units_per_uom`, and the resulting `qty_base` is stored too.
--
-- This is not redundancy. `products.units_per_shrink` is editable, and if a
-- report multiplied a historical receipt by today's pack size then correcting a
-- product from 10-per-shrink to 12 would silently restate every delivery ever
-- taken. The same reasoning as promotion_stores: a finished event's numbers
-- cannot change afterwards because somebody edited a lookup.
--
-- 'case' has no factor in the catalogue — there is no units_per_case column —
-- so a case line must carry its own `units_per_uom`. That is deliberate rather
-- than an omission: case configurations vary per delivery for several of these
-- lines, and a guessed constant would be worse than asking.
--
-- ------------------------------------------------------------- cancelling
--
-- Cancelling a posted receipt posts the reversing movements. It does not try to
-- work out whether the stock is still there — it simply takes it back out, and
-- if it has already been sold the ledger's non-negative check refuses and the
-- clerk is told why. That is stronger than any check this code could write, and
-- it cannot drift out of step with the balance.

-- ----------------------------------------------------------- goods_receipts

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  grn_number text not null,
  receipt_type text not null default 'supplier',

  supplier_id uuid references public.suppliers(id) on delete restrict,
  -- Snapshot. A supplier renamed next year must not rewrite what this delivery
  -- said at the time.
  supplier_name text,
  invoice_number text,

  location_id uuid not null references public.stock_locations(id) on delete restrict,
  received_at timestamptz not null default now(),
  status text not null default 'draft',
  notes text,

  received_by uuid references public.profiles(id) on delete set null,
  posted_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.goods_receipts is
  'Goods received notes. Draft until posted; posting is what creates the stock. Also carries opening stock and customer returns.';

alter table public.goods_receipts drop constraint if exists goods_receipts_type_check;
alter table public.goods_receipts add constraint goods_receipts_type_check
  check (receipt_type in ('supplier', 'opening_stock', 'customer_return'));

alter table public.goods_receipts drop constraint if exists goods_receipts_status_check;
alter table public.goods_receipts add constraint goods_receipts_status_check
  check (status in ('draft', 'posted', 'cancelled'));

-- A supplier delivery has to say who from. The other two types have no supplier
-- by definition, so the requirement is conditional rather than a not-null.
alter table public.goods_receipts drop constraint if exists goods_receipts_supplier_named;
alter table public.goods_receipts add constraint goods_receipts_supplier_named
  check (receipt_type <> 'supplier' or supplier_name is not null);

alter table public.goods_receipts drop constraint if exists goods_receipts_cancel_reason;
alter table public.goods_receipts add constraint goods_receipts_cancel_reason
  check (status <> 'cancelled' or cancel_reason is not null);

alter table public.goods_receipts drop constraint if exists goods_receipts_posted_stamped;
alter table public.goods_receipts add constraint goods_receipts_posted_stamped
  check (status <> 'posted' or posted_at is not null);

create unique index if not exists goods_receipts_org_number_key
  on public.goods_receipts (org_id, grn_number);
create index if not exists goods_receipts_org_status_idx
  on public.goods_receipts (org_id, status, received_at desc);
create index if not exists goods_receipts_supplier_idx
  on public.goods_receipts (supplier_id) where supplier_id is not null;

drop trigger if exists goods_receipts_set_updated_at on public.goods_receipts;
create trigger goods_receipts_set_updated_at
  before update on public.goods_receipts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ goods_receipt_lines

create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,

  batch_number text,
  expiry_date date,
  manufactured_on date,

  uom text not null default 'each',
  -- Null while drafting for 'each' and 'shrink' (resolved at post time from the
  -- product); required up front for 'case', which the catalogue cannot answer.
  units_per_uom integer,

  qty_received integer not null,
  qty_damaged integer not null default 0,
  -- Written at post time. The received quantity in base units, using the factor
  -- that was true when it was posted.
  qty_base integer,

  unit_cost numeric(12,2),
  notes text,
  created_at timestamptz not null default now()
);

comment on column public.goods_receipt_lines.qty_base is
  'Received quantity in base sellable units, frozen at post time. Never recompute this from the product — its pack size may have been corrected since.';

alter table public.goods_receipt_lines drop constraint if exists goods_receipt_lines_uom_check;
alter table public.goods_receipt_lines add constraint goods_receipt_lines_uom_check
  check (uom in ('each', 'shrink', 'case'));

alter table public.goods_receipt_lines drop constraint if exists goods_receipt_lines_qty_check;
alter table public.goods_receipt_lines add constraint goods_receipt_lines_qty_check
  check (
    qty_received > 0
    and qty_damaged >= 0
    and qty_damaged <= qty_received
    and (units_per_uom is null or units_per_uom > 0)
    and (qty_base is null or qty_base > 0)
  );

-- A case has no catalogue factor, so the clerk must supply one.
alter table public.goods_receipt_lines drop constraint if exists goods_receipt_lines_case_needs_factor;
alter table public.goods_receipt_lines add constraint goods_receipt_lines_case_needs_factor
  check (uom <> 'case' or units_per_uom is not null);

alter table public.goods_receipt_lines drop constraint if exists goods_receipt_lines_dates_sane;
alter table public.goods_receipt_lines add constraint goods_receipt_lines_dates_sane
  check (
    manufactured_on is null or expiry_date is null
    or expiry_date >= manufactured_on
  );

create index if not exists goods_receipt_lines_parent_idx
  on public.goods_receipt_lines (goods_receipt_id);
create index if not exists goods_receipt_lines_product_idx
  on public.goods_receipt_lines (org_id, product_id);

/**
 * A line's product, and its parent receipt, belong to the caller's org.
 *
 * The same ownership hole the ledger and locations already close. Also pins the
 * line's org to its parent's, so a line cannot be filed under a receipt in
 * another tenant.
 */
create or replace function public.goods_receipt_lines_enforce_org()
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
  from public.goods_receipts where id = new.goods_receipt_id;

  if v_org is distinct from new.org_id then
    raise exception 'That goods received note belongs to another organisation.'
      using errcode = '42501';
  end if;

  -- Lines are a draft-time concept. Once posted, the receipt is a record of
  -- what arrived, and editing a line would leave the ledger describing a
  -- delivery that the note no longer claims to have taken.
  if v_status <> 'draft' then
    raise exception 'Goods received note % has already been %; its lines cannot be changed.',
      (select grn_number from public.goods_receipts where id = new.goods_receipt_id),
      v_status
      using errcode = '42501';
  end if;

  select org_id into v_org from public.products where id = new.product_id;
  if v_org is distinct from new.org_id then
    raise exception 'That product belongs to another organisation.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists goods_receipt_lines_org_guard on public.goods_receipt_lines;
create trigger goods_receipt_lines_org_guard
  before insert or update on public.goods_receipt_lines
  for each row execute function public.goods_receipt_lines_enforce_org();

-- ---------------------------------------------------------------------- RLS

alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;

drop policy if exists goods_receipts_select on public.goods_receipts;
create policy goods_receipts_select on public.goods_receipts
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists goods_receipts_insert on public.goods_receipts;
create policy goods_receipts_insert on public.goods_receipts
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  );

-- Only while draft. The status column itself is revoked below, so this governs
-- the supplier, invoice and notes — not the transition.
drop policy if exists goods_receipts_update on public.goods_receipts;
create policy goods_receipts_update on public.goods_receipts
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  ) with check (
    org_id = (select public.current_org_id())
  );

drop policy if exists goods_receipts_delete on public.goods_receipts;
create policy goods_receipts_delete on public.goods_receipts
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  );

drop policy if exists goods_receipt_lines_select on public.goods_receipt_lines;
create policy goods_receipt_lines_select on public.goods_receipt_lines
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- The parent's draft status is enforced by the trigger above for every verb, so
-- these policies only have to answer "is it mine".
drop policy if exists goods_receipt_lines_insert on public.goods_receipt_lines;
create policy goods_receipt_lines_insert on public.goods_receipt_lines
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists goods_receipt_lines_update on public.goods_receipt_lines;
create policy goods_receipt_lines_update on public.goods_receipt_lines
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  ) with check (
    org_id = (select public.current_org_id())
  );

drop policy if exists goods_receipt_lines_delete on public.goods_receipt_lines;
create policy goods_receipt_lines_delete on public.goods_receipt_lines
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- RLS sees a row, not a diff, so it cannot express "this column is read-only".
-- Everything that decides whether stock exists is server-controlled: only the
-- RPCs below may set it. Same technique as lock_privilege_and_gps_fields.
revoke update on public.goods_receipts from authenticated, anon;
grant update (
  supplier_id, supplier_name, invoice_number, location_id,
  received_at, notes, received_by, updated_at
) on public.goods_receipts to authenticated;

revoke update on public.goods_receipt_lines from authenticated, anon;
grant update (
  product_id, batch_number, expiry_date, manufactured_on,
  uom, units_per_uom, qty_received, qty_damaged, unit_cost, notes
) on public.goods_receipt_lines to authenticated;

-- ----------------------------------------------------------------- the RPCs

/**
 * Posts a draft goods received note: creates any new batches, converts to base
 * units, and writes the movements that bring the stock into existence.
 *
 * SECURITY DEFINER, because it writes stock_movements — a table with no insert
 * policy and no insert privilege, by design. The role and organisation are
 * therefore checked explicitly here, in the way `close_abandoned_workday`
 * established, rather than being left to RLS.
 *
 * Returns a jsonb summary: the note, and per line what was created.
 */
create or replace function public.goods_receipt_post(p_goods_receipt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_grn public.goods_receipts;
  v_role text;
  v_org uuid;
  v_line record;
  v_factor integer;
  v_base integer;
  v_good integer;
  v_batch_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can post a goods received note.'
      using errcode = '42501';
  end if;

  -- Serialise per note. Two clerks pressing Post at the same moment must not
  -- both succeed and double the stock; the loser finds it already posted.
  perform pg_advisory_xact_lock(hashtext('goods_receipt_post'),
                                hashtext(p_goods_receipt_id::text));

  select * into v_grn from public.goods_receipts
  where id = p_goods_receipt_id and org_id = v_org;

  if not found then
    raise exception 'That goods received note does not exist.' using errcode = 'P0002';
  end if;
  if v_grn.status <> 'draft' then
    raise exception 'Goods received note % is already %.', v_grn.grn_number, v_grn.status
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.goods_receipt_lines
                 where goods_receipt_id = v_grn.id) then
    raise exception 'Goods received note % has no lines.', v_grn.grn_number
      using errcode = '42501';
  end if;

  -- Sorted, so two concurrent posts touching the same products always take the
  -- balance rows in the same order and cannot deadlock against each other.
  for v_line in
    select l.*, p.is_batch_tracked, p.is_stock_tracked, p.units_per_shrink, p.name as product_name
    from public.goods_receipt_lines l
    join public.products p on p.id = l.product_id
    where l.goods_receipt_id = v_grn.id
    order by l.product_id, l.batch_number nulls first, l.id
  loop
    if not v_line.is_stock_tracked then
      raise exception '% is not stock-tracked and cannot be received.', v_line.product_name
        using errcode = '42501';
    end if;

    -- The conversion factor, frozen onto the line.
    v_factor := case
      when v_line.units_per_uom is not null then v_line.units_per_uom
      when v_line.uom = 'each' then 1
      when v_line.uom = 'shrink' then v_line.units_per_shrink
      else null
    end;

    if v_factor is null or v_factor < 1 then
      raise exception
        'How many units are in a % of %? Set the pack size on the product, or enter it on the line.',
        v_line.uom, v_line.product_name
        using errcode = '22023';
    end if;

    v_base := v_line.qty_received * v_factor;
    v_good := (v_line.qty_received - v_line.qty_damaged) * v_factor;

    -- Batches: demanded for tracked products, refused for untracked ones so a
    -- batch number cannot be recorded against stock that is not kept apart.
    v_batch_id := null;
    if v_line.is_batch_tracked then
      if v_line.batch_number is null or btrim(v_line.batch_number) = '' then
        raise exception '% is batch-tracked; every line needs a batch number.',
          v_line.product_name using errcode = '22023';
      end if;

      select id into v_batch_id from public.product_batches
      where org_id = v_org and product_id = v_line.product_id
        and lower(batch_number) = lower(btrim(v_line.batch_number));

      if v_batch_id is null then
        insert into public.product_batches
          (org_id, product_id, batch_number, expiry_date, manufactured_on, first_received_at)
        values (v_org, v_line.product_id, btrim(v_line.batch_number),
                v_line.expiry_date, v_line.manufactured_on, v_grn.received_at)
        returning id into v_batch_id;
      end if;
    elsif v_line.batch_number is not null and btrim(v_line.batch_number) <> '' then
      raise exception
        '% is not batch-tracked, so a batch number cannot be recorded against it.',
        v_line.product_name using errcode = '22023';
    end if;

    update public.goods_receipt_lines
       set units_per_uom = v_factor, qty_base = v_base
     where id = v_line.id;

    if v_good > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        to_location_id, to_bucket, reason, reference,
        source_doc_type, source_doc_id, source_line_id, occurred_at, actor_id)
      values (
        v_org, v_line.product_id, v_batch_id, v_good,
        v_grn.location_id, 'available',
        case when v_grn.receipt_type = 'opening_stock' then 'opening_stock'
             when v_grn.receipt_type = 'customer_return' then 'customer_return'
             else 'goods_receipt' end,
        v_grn.grn_number,
        'goods_receipt', v_grn.id, v_line.id, v_grn.received_at, auth.uid());
    end if;

    -- Damage noted on arrival lands in the damaged bucket rather than being
    -- quietly left out. It was delivered; it is ours; it is not sellable. A
    -- receipt that silently dropped it would make the supplier claim
    -- unprovable.
    if v_line.qty_damaged > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        to_location_id, to_bucket, reason, reference,
        source_doc_type, source_doc_id, source_line_id, occurred_at, actor_id, note)
      values (
        v_org, v_line.product_id, v_batch_id, v_line.qty_damaged * v_factor,
        v_grn.location_id, 'damaged', 'goods_receipt', v_grn.grn_number,
        'goods_receipt', v_grn.id, v_line.id, v_grn.received_at, auth.uid(),
        'Damaged on arrival');
    end if;

    v_total := v_total + v_base;
    v_lines := v_lines || jsonb_build_object(
      'line_id', v_line.id,
      'product_id', v_line.product_id,
      'product_name', v_line.product_name,
      'batch_id', v_batch_id,
      'units_per_uom', v_factor,
      'qty_base', v_base,
      'qty_good', v_good,
      'qty_damaged', v_line.qty_damaged * v_factor);
  end loop;

  update public.goods_receipts
     set status = 'posted', posted_by = auth.uid(), posted_at = now()
   where id = v_grn.id;

  return jsonb_build_object(
    'goods_receipt_id', v_grn.id,
    'grn_number', v_grn.grn_number,
    'status', 'posted',
    'total_base_units', v_total,
    'lines', v_lines);
end;
$$;

comment on function public.goods_receipt_post(uuid) is
  'Posts a draft goods received note, creating batches and the movements that bring stock into existence.';

/**
 * Reverses a posted goods received note.
 *
 * Posts the opposite movements rather than deleting anything — the ledger is
 * append-only and a receipt that happened, happened. If the stock has since
 * been sold or moved, the balance's non-negative check refuses and the clerk is
 * told which product is the problem. That is a stronger guarantee than
 * inspecting the balance first, because it cannot race.
 */
create or replace function public.goods_receipt_cancel(
  p_goods_receipt_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_grn public.goods_receipts;
  v_role text;
  v_org uuid;
  v_mv record;
  v_reversed integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can cancel a goods received note.'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the goods received note is being cancelled.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('goods_receipt_post'),
                                hashtext(p_goods_receipt_id::text));

  select * into v_grn from public.goods_receipts
  where id = p_goods_receipt_id and org_id = v_org;

  if not found then
    raise exception 'That goods received note does not exist.' using errcode = 'P0002';
  end if;
  if v_grn.status = 'cancelled' then
    raise exception 'Goods received note % is already cancelled.', v_grn.grn_number
      using errcode = '42501';
  end if;

  if v_grn.status = 'posted' then
    for v_mv in
      select m.* from public.stock_movements m
      where m.source_doc_type = 'goods_receipt' and m.source_doc_id = v_grn.id
      order by m.product_id, m.batch_id nulls first, m.id
    loop
      begin
        insert into public.stock_movements (
          org_id, product_id, batch_id, qty,
          from_location_id, from_bucket, reason, reference,
          source_doc_type, source_doc_id, source_line_id, actor_id, note)
        values (
          v_mv.org_id, v_mv.product_id, v_mv.batch_id, v_mv.qty,
          v_mv.to_location_id, v_mv.to_bucket, 'grn_correction', v_grn.grn_number,
          'goods_receipt', v_grn.id, v_mv.source_line_id, auth.uid(),
          'Cancelled: ' || p_reason);
      exception when check_violation then
        raise exception
          'This delivery cannot be cancelled: some of % has already been used or moved. Adjust the stock instead.',
          (select name from public.products where id = v_mv.product_id)
          using errcode = '42501';
      end;
      v_reversed := v_reversed + 1;
    end loop;
  end if;

  update public.goods_receipts
     set status = 'cancelled', cancelled_by = auth.uid(),
         cancelled_at = now(), cancel_reason = p_reason
   where id = v_grn.id;

  return jsonb_build_object(
    'goods_receipt_id', v_grn.id,
    'grn_number', v_grn.grn_number,
    'status', 'cancelled',
    'movements_reversed', v_reversed);
end;
$$;

comment on function public.goods_receipt_cancel(uuid, text) is
  'Cancels a goods received note, reversing its movements. Refuses if the stock has already moved on.';

revoke all on function public.goods_receipt_post(uuid) from public, anon;
grant execute on function public.goods_receipt_post(uuid) to authenticated;
revoke all on function public.goods_receipt_cancel(uuid, text) from public, anon;
grant execute on function public.goods_receipt_cancel(uuid, text) to authenticated;
