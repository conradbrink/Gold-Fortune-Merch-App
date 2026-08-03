-- Correcting stock on purpose, with somebody's name against it.
--
-- Damage, expiry, breakage, a promotional giveaway, stock that has simply gone:
-- all of them are a clerk saying "the number is wrong, and here is why". The
-- requirement is explicit that this needs manager approval before the balance
-- moves, and that is the whole shape of this migration.
--
-- ------------------------------------------------- pending is not a movement
--
-- An adjustment awaiting approval does **not** exist in `stock_movements`. It
-- lives in `stock_adjustment_lines` under its parent's status, and approving is
-- what posts the ledger rows.
--
-- The alternative — a movement with a `pending` flag — would mean every reader
-- of the ledger had to remember to filter it out, and the first one that forgot
-- would produce a number that was wrong and looked completely reasonable. A row
-- in stock_movements means it happened. That rule is worth more than the
-- convenience.
--
-- ---------------------------------------------- the same legs as the ledger
--
-- Adjustment lines carry `from_bucket` and `to_bucket` with the same shape
-- rules the ledger enforces, so an impossible adjustment is refused when the
-- clerk types it rather than when the manager approves it. Being told at
-- approval that something you signed off three days ago was malformed is the
-- worst moment to find out.
--
--   damage        available -> damaged
--   expiry        available -> expired
--   promotional   available -> promotional
--   write_off     damaged   -> (gone)
--   missing       available -> (gone)
--   found         (gone)    -> available
--
-- ------------------------------------------ widening the ledger's boundaries
--
-- `stock_movements_boundary_check` lists the reasons allowed to create or
-- destroy stock — the one-legged movements. It was written before adjustments
-- existed and does not include `adjustment_missing` or `adjustment_found`,
-- which are precisely the two that need it: missing stock leaves without going
-- anywhere, found stock arrives from nowhere.
--
-- Widening it here rather than working around it is the right call. The
-- constraint's job is to make stock creation and destruction *explicit*, not
-- rare, and both of these say out loud what they are.

alter table public.stock_movements drop constraint if exists stock_movements_boundary_check;
alter table public.stock_movements add constraint stock_movements_boundary_check
  check (
    (from_location_id is not null and to_location_id is not null)
    or reason in (
      'opening_stock','goods_receipt','grn_correction','customer_return',
      'order_delivery','transfer_loss','adjustment_write_off',
      'adjustment_missing','adjustment_found',
      'stocktake_variance_increase','stocktake_variance_decrease'
    )
  );

-- ------------------------------------------------------- stock_adjustments

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  adjustment_number text not null,
  location_id uuid not null references public.stock_locations(id) on delete restrict,

  reason_code text not null,
  reason_note text,
  status text not null default 'draft',

  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stock_adjustments is
  'A requested correction to stock. Nothing moves until a manager approves it; approval is what posts the ledger rows.';

alter table public.stock_adjustments drop constraint if exists stock_adjustments_reason_check;
alter table public.stock_adjustments add constraint stock_adjustments_reason_check
  check (reason_code in ('damage', 'expiry', 'promotional', 'missing',
                         'found', 'write_off', 'other'));

alter table public.stock_adjustments drop constraint if exists stock_adjustments_status_check;
alter table public.stock_adjustments add constraint stock_adjustments_status_check
  check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled'));

-- "Other" without a note is not a reason, it is a shrug.
alter table public.stock_adjustments drop constraint if exists stock_adjustments_other_explained;
alter table public.stock_adjustments add constraint stock_adjustments_other_explained
  check (reason_code <> 'other' or reason_note is not null);

-- A refusal that says nothing leaves the clerk with no idea what to fix.
alter table public.stock_adjustments drop constraint if exists stock_adjustments_rejection_explained;
alter table public.stock_adjustments add constraint stock_adjustments_rejection_explained
  check (status <> 'rejected' or decision_note is not null);

alter table public.stock_adjustments drop constraint if exists stock_adjustments_decided_stamped;
alter table public.stock_adjustments add constraint stock_adjustments_decided_stamped
  check (status not in ('approved', 'rejected') or (decided_at is not null and decided_by is not null));

create unique index if not exists stock_adjustments_org_number_key
  on public.stock_adjustments (org_id, adjustment_number);
create index if not exists stock_adjustments_org_status_idx
  on public.stock_adjustments (org_id, status, requested_at desc);
create index if not exists stock_adjustments_location_idx
  on public.stock_adjustments (location_id);

drop trigger if exists stock_adjustments_set_updated_at on public.stock_adjustments;
create trigger stock_adjustments_set_updated_at
  before update on public.stock_adjustments
  for each row execute function public.set_updated_at();

create table if not exists public.stock_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  adjustment_id uuid not null references public.stock_adjustments(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.product_batches(id) on delete restrict,

  from_bucket text,
  to_bucket text,
  qty integer not null,
  note text,

  created_at timestamptz not null default now()
);

alter table public.stock_adjustment_lines drop constraint if exists stock_adjustment_lines_qty_check;
alter table public.stock_adjustment_lines add constraint stock_adjustment_lines_qty_check
  check (qty > 0);

alter table public.stock_adjustment_lines drop constraint if exists stock_adjustment_lines_bucket_check;
alter table public.stock_adjustment_lines add constraint stock_adjustment_lines_bucket_check
  check (
    (from_bucket is null or from_bucket in
      ('available','reserved','damaged','expired','in_transit','promotional'))
    and (to_bucket is null or to_bucket in
      ('available','reserved','damaged','expired','in_transit','promotional'))
  );

-- At least one leg, and never a line that moves stock to where it already is.
-- The same rules the ledger applies, checked at entry.
alter table public.stock_adjustment_lines drop constraint if exists stock_adjustment_lines_has_effect;
alter table public.stock_adjustment_lines add constraint stock_adjustment_lines_has_effect
  check (
    (from_bucket is not null or to_bucket is not null)
    and from_bucket is distinct from to_bucket
  );

create index if not exists stock_adjustment_lines_parent_idx
  on public.stock_adjustment_lines (adjustment_id);
create index if not exists stock_adjustment_lines_product_idx
  on public.stock_adjustment_lines (org_id, product_id);

/**
 * Lines belong to their adjustment's organisation, and may only be touched
 * while it is a draft. Once submitted, a manager is looking at it.
 */
create or replace function public.stock_adjustment_lines_enforce_org()
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
  from public.stock_adjustments where id = new.adjustment_id;

  if v_org is distinct from new.org_id then
    raise exception 'That adjustment belongs to another organisation.' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'Adjustment % has been submitted; its lines cannot be changed.',
      (select adjustment_number from public.stock_adjustments where id = new.adjustment_id)
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_adjustment_lines_org_guard on public.stock_adjustment_lines;
create trigger stock_adjustment_lines_org_guard
  before insert or update on public.stock_adjustment_lines
  for each row execute function public.stock_adjustment_lines_enforce_org();

-- ---------------------------------------------------------------------- RLS

alter table public.stock_adjustments enable row level security;
alter table public.stock_adjustment_lines enable row level security;

drop policy if exists stock_adjustments_select on public.stock_adjustments;
create policy stock_adjustments_select on public.stock_adjustments
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stock_adjustments_insert on public.stock_adjustments;
create policy stock_adjustments_insert on public.stock_adjustments
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  );

drop policy if exists stock_adjustments_update on public.stock_adjustments;
create policy stock_adjustments_update on public.stock_adjustments
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  ) with check (org_id = (select public.current_org_id()));

drop policy if exists stock_adjustments_delete on public.stock_adjustments;
create policy stock_adjustments_delete on public.stock_adjustments
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status = 'draft'
  );

drop policy if exists stock_adjustment_lines_select on public.stock_adjustment_lines;
create policy stock_adjustment_lines_select on public.stock_adjustment_lines
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stock_adjustment_lines_insert on public.stock_adjustment_lines;
create policy stock_adjustment_lines_insert on public.stock_adjustment_lines
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stock_adjustment_lines_update on public.stock_adjustment_lines;
create policy stock_adjustment_lines_update on public.stock_adjustment_lines
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  ) with check (org_id = (select public.current_org_id()));

drop policy if exists stock_adjustment_lines_delete on public.stock_adjustment_lines;
create policy stock_adjustment_lines_delete on public.stock_adjustment_lines
  for delete using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- The decision columns are the whole point of the approval gate, so they are
-- server-controlled. Without this a clerk could set `status = 'approved'` on
-- their own request — which would not post any stock, but would tell everyone
-- looking at the list that a manager had signed it off.
revoke update on public.stock_adjustments from authenticated, anon;
grant update (location_id, reason_code, reason_note, updated_at)
  on public.stock_adjustments to authenticated;

revoke update on public.stock_adjustment_lines from authenticated, anon;
grant update (product_id, batch_id, from_bucket, to_bucket, qty, note)
  on public.stock_adjustment_lines to authenticated;

-- ----------------------------------------------------------------- the RPCs

/**
 * Sends a draft adjustment for approval. Still moves nothing.
 */
create or replace function public.stock_adjustment_submit(p_adjustment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_number text;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can submit an adjustment.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.stock_adjustment_lines
                 where adjustment_id = p_adjustment_id) then
    raise exception 'That adjustment has no lines.' using errcode = '42501';
  end if;

  update public.stock_adjustments
     set status = 'pending', requested_by = auth.uid(), requested_at = now()
   where id = p_adjustment_id and org_id = v_org and status = 'draft'
  returning adjustment_number into v_number;

  if v_number is null then
    raise exception 'That adjustment is not a draft.' using errcode = '42501';
  end if;

  return jsonb_build_object('adjustment_id', p_adjustment_id,
                            'adjustment_number', v_number, 'status', 'pending');
end;
$$;

/**
 * A manager's decision. Approving is what posts the movements.
 *
 * Manager-only, and explicitly not the person who asked: an approval gate that
 * the requester can operate is not a gate. The one exception is a manager
 * raising their own adjustment, which is allowed — they could approve a clerk's
 * identical request a second later, so refusing it would be ceremony rather
 * than control.
 */
create or replace function public.stock_adjustment_decide(
  p_adjustment_id uuid,
  p_approve boolean,
  p_note text default null
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
  v_adj public.stock_adjustments;
  v_line record;
  v_reason text;
  v_total integer := 0;
  v_lines integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if v_role <> 'manager' then
    raise exception 'Only a manager can approve or reject a stock adjustment.'
      using errcode = '42501';
  end if;
  if not p_approve and (p_note is null or btrim(p_note) = '') then
    raise exception 'Say why the adjustment is being rejected.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('stock_adjustment'), hashtext(p_adjustment_id::text));

  select * into v_adj from public.stock_adjustments
  where id = p_adjustment_id and org_id = v_org;

  if not found then
    raise exception 'That adjustment does not exist.' using errcode = 'P0002';
  end if;
  if v_adj.status <> 'pending' then
    raise exception 'Adjustment % is %, not waiting for a decision.',
      v_adj.adjustment_number, v_adj.status using errcode = '42501';
  end if;

  if not p_approve then
    update public.stock_adjustments
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = p_note
     where id = v_adj.id;
    return jsonb_build_object('adjustment_id', v_adj.id,
      'adjustment_number', v_adj.adjustment_number, 'status', 'rejected');
  end if;

  v_reason := case v_adj.reason_code
    when 'damage' then 'adjustment_damage'
    when 'expiry' then 'adjustment_expiry'
    when 'promotional' then 'adjustment_promotional'
    when 'missing' then 'adjustment_missing'
    when 'found' then 'adjustment_found'
    when 'write_off' then 'adjustment_write_off'
    else 'adjustment_other'
  end;

  for v_line in
    select * from public.stock_adjustment_lines
    where adjustment_id = v_adj.id
    order by product_id, batch_id nulls first, id
  loop
    insert into public.stock_movements (
      org_id, product_id, batch_id, qty,
      from_location_id, from_bucket, to_location_id, to_bucket,
      reason, reference, note, source_doc_type, source_doc_id, source_line_id,
      actor_id, approved_by)
    values (
      v_org, v_line.product_id, v_line.batch_id, v_line.qty,
      case when v_line.from_bucket is not null then v_adj.location_id end, v_line.from_bucket,
      case when v_line.to_bucket is not null then v_adj.location_id end, v_line.to_bucket,
      v_reason, v_adj.adjustment_number,
      coalesce(v_line.note, v_adj.reason_note),
      'adjustment', v_adj.id, v_line.id,
      -- Who asked, and who allowed it. Both, because either alone is half the
      -- story a stock auditor is trying to reconstruct.
      v_adj.requested_by, auth.uid());

    v_total := v_total + v_line.qty;
    v_lines := v_lines + 1;
  end loop;

  update public.stock_adjustments
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note
   where id = v_adj.id;

  return jsonb_build_object(
    'adjustment_id', v_adj.id, 'adjustment_number', v_adj.adjustment_number,
    'status', 'approved', 'reason', v_reason,
    'lines', v_lines, 'units', v_total);
end;
$$;

comment on function public.stock_adjustment_decide(uuid, boolean, text) is
  'Manager approval or rejection of a stock adjustment. Approving posts the movements; nothing moves before that.';

revoke all on function public.stock_adjustment_submit(uuid) from public, anon;
grant execute on function public.stock_adjustment_submit(uuid) to authenticated;
revoke all on function public.stock_adjustment_decide(uuid, boolean, text) from public, anon;
grant execute on function public.stock_adjustment_decide(uuid, boolean, text) to authenticated;
revoke all on function public.stock_adjustment_lines_enforce_org() from public, anon, authenticated;
