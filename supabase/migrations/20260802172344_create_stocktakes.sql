-- Counting the stock, and reconciling what is there with what we think.
--
-- 🔴 THE TRAP THIS MIGRATION EXISTS TO AVOID
--
-- Between opening a stocktake and approving it, real movements happen: a
-- delivery is taken, an order goes out. If the variance is computed as
-- `counted - (system when the count opened)`, every one of those movements is
-- counted twice — once by the trade that caused it, once by the variance. The
-- resulting report looks entirely reasonable and is wrong by exactly one day's
-- trading, which is the worst kind of wrong.
--
-- So a line carries three numbers, not two:
--
--   system_qty_at_open     what the system said when counting started
--   system_qty_at_submit   what it said when the sheet was handed in — this is
--                          what the variance is measured against
--   (live, read at decide) what it says at the moment of approval
--
-- and `stocktake_decide` **refuses any line whose live balance has moved since
-- submit**, unless the manager re-confirms that specific line having been shown
-- both numbers. A stocktake is a statement about a moment; approving it days
-- later without checking is signing for a moment that has passed.
--
-- ------------------------------------------------------------- the freeze
--
-- A full count of a location can set `freeze_movements`, which stops the stock
-- moving underneath the counters. It is enforced by a trigger on
-- `stock_movements` rather than by a check inside each RPC — one place, and it
-- therefore also covers every RPC written after this one. The stocktake's own
-- variance postings are exempt, which is the only exemption.
--
-- Cycle and spot counts do not freeze. Stopping the warehouse to count one
-- shelf is not a trade anybody would make.
--
-- ------------------------------------------------------- what gets counted
--
-- Lines are snapshotted per (product, batch) at the location and compare
-- against `qty_on_hand` — everything physically present, whatever its
-- condition, because that is what a person walking the aisle can see. Variances
-- post against `available`.
--
-- ⚠️ A negative variance larger than `available` will be refused by the
-- ledger's non-negative check. That is correct rather than awkward: the missing
-- units are being held for somebody's order, and releasing them is a decision
-- about that order, not something a count should do silently.
--
-- Stock physically present with no balance row at all cannot be counted here —
-- there is no line to write on. That is a `found` stock adjustment, which is
-- the right instrument because it needs a manager to agree the stock exists.

create table if not exists public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  stocktake_number text not null,
  location_id uuid not null references public.stock_locations(id) on delete restrict,

  stocktake_type text not null,
  status text not null default 'draft',
  freeze_movements boolean not null default false,

  scheduled_for date,
  started_at timestamptz,
  started_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text,

  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.stocktakes is
  'A physical count. Variances are measured against the system quantity at submit, and need manager approval before they touch the balance.';

alter table public.stocktakes drop constraint if exists stocktakes_type_check;
alter table public.stocktakes add constraint stocktakes_type_check
  check (stocktake_type in ('full', 'cycle', 'spot'));

alter table public.stocktakes drop constraint if exists stocktakes_status_check;
alter table public.stocktakes add constraint stocktakes_status_check
  check (status in ('draft', 'counting', 'submitted', 'approved', 'rejected', 'cancelled'));

alter table public.stocktakes drop constraint if exists stocktakes_rejection_explained;
alter table public.stocktakes add constraint stocktakes_rejection_explained
  check (status <> 'rejected' or decision_note is not null);

alter table public.stocktakes drop constraint if exists stocktakes_decided_stamped;
alter table public.stocktakes add constraint stocktakes_decided_stamped
  check (status not in ('approved', 'rejected')
         or (decided_at is not null and decided_by is not null));

-- Only a full count may stop the warehouse.
alter table public.stocktakes drop constraint if exists stocktakes_freeze_is_full_only;
alter table public.stocktakes add constraint stocktakes_freeze_is_full_only
  check (freeze_movements = false or stocktake_type = 'full');

create unique index if not exists stocktakes_org_number_key
  on public.stocktakes (org_id, stocktake_number);
create index if not exists stocktakes_org_status_idx
  on public.stocktakes (org_id, status, created_at desc);
-- The lookup the freeze trigger does on every single movement, so it has to be
-- an index hit rather than a scan.
create index if not exists stocktakes_frozen_idx
  on public.stocktakes (location_id)
  where freeze_movements and status in ('draft', 'counting', 'submitted');

drop trigger if exists stocktakes_set_updated_at on public.stocktakes;
create trigger stocktakes_set_updated_at
  before update on public.stocktakes
  for each row execute function public.set_updated_at();

create table if not exists public.stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.product_batches(id) on delete restrict,

  system_qty_at_open integer not null,
  counted_qty integer,
  recount_qty integer,
  system_qty_at_submit integer,

  -- Null until the sheet is submitted, because until then there is nothing
  -- honest to measure against.
  variance_qty integer generated always as
    (coalesce(recount_qty, counted_qty) - system_qty_at_submit) stored,

  variance_reason text,
  line_status text not null default 'pending',
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stocktake_lines drop constraint if exists stocktake_lines_qty_check;
alter table public.stocktake_lines add constraint stocktake_lines_qty_check
  check (
    system_qty_at_open >= 0
    and (counted_qty is null or counted_qty >= 0)
    and (recount_qty is null or recount_qty >= 0)
    and (system_qty_at_submit is null or system_qty_at_submit >= 0)
  );

alter table public.stocktake_lines drop constraint if exists stocktake_lines_status_check;
alter table public.stocktake_lines add constraint stocktake_lines_status_check
  check (line_status in ('pending', 'counted', 'accepted', 'rejected', 'recount'));

alter table public.stocktake_lines drop constraint if exists stocktake_lines_variance_reason_check;
alter table public.stocktake_lines add constraint stocktake_lines_variance_reason_check
  check (
    variance_reason is null
    or variance_reason in ('miscount', 'theft', 'damage_unrecorded', 'expiry_unrecorded',
                           'receiving_error', 'picking_error', 'system_error', 'other')
  );

create unique index if not exists stocktake_lines_key
  on public.stocktake_lines (stocktake_id, product_id, batch_id) nulls not distinct;
create index if not exists stocktake_lines_parent_idx on public.stocktake_lines (stocktake_id);

drop trigger if exists stocktake_lines_set_updated_at on public.stocktake_lines;
create trigger stocktake_lines_set_updated_at
  before update on public.stocktake_lines
  for each row execute function public.set_updated_at();

/**
 * Lines belong to their stocktake's organisation, and only a stocktake that is
 * still being counted accepts changes to them.
 */
create or replace function public.stocktake_lines_enforce_org()
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
  from public.stocktakes where id = new.stocktake_id;

  if v_org is distinct from new.org_id then
    raise exception 'That stocktake belongs to another organisation.' using errcode = '42501';
  end if;

  -- The submit and decide RPCs write to lines on a submitted stocktake and run
  -- as definer; a signed-in counter has no privilege on those columns.
  if v_status in ('draft', 'counting')
     or current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  raise exception 'Stocktake % has been submitted; its counts cannot be changed.',
    (select stocktake_number from public.stocktakes where id = new.stocktake_id)
    using errcode = '42501';
end;
$$;

drop trigger if exists stocktake_lines_org_guard on public.stocktake_lines;
create trigger stocktake_lines_org_guard
  before insert or update on public.stocktake_lines
  for each row execute function public.stocktake_lines_enforce_org();

-- --------------------------------------------------------------- the freeze

/**
 * Refuses to move stock at a location that is frozen for a full count.
 *
 * On `stock_movements` rather than inside each RPC, so it covers every path
 * that exists and every path written later. The stocktake's own variance
 * postings are the single exemption — they are what ends the freeze.
 */
create or replace function public.stock_movements_respect_freeze()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_number text;
begin
  if new.source_doc_type = 'stocktake' then
    return new;
  end if;

  select s.stocktake_number into v_number
  from public.stocktakes s
  where s.freeze_movements
    and s.status in ('draft', 'counting', 'submitted')
    and s.location_id in (new.from_location_id, new.to_location_id)
  limit 1;

  if v_number is not null then
    raise exception
      'Stocktake % is counting that location. Finish or cancel it before moving stock.',
      v_number using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists stock_movements_freeze_guard on public.stock_movements;
create trigger stock_movements_freeze_guard
  before insert on public.stock_movements
  for each row execute function public.stock_movements_respect_freeze();

-- ---------------------------------------------------------------------- RLS

alter table public.stocktakes enable row level security;
alter table public.stocktake_lines enable row level security;

drop policy if exists stocktakes_select on public.stocktakes;
create policy stocktakes_select on public.stocktakes
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stocktakes_insert on public.stocktakes;
create policy stocktakes_insert on public.stocktakes
  for insert with check (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

drop policy if exists stocktakes_update on public.stocktakes;
create policy stocktakes_update on public.stocktakes
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
    and status in ('draft', 'counting')
  ) with check (org_id = (select public.current_org_id()));

drop policy if exists stocktake_lines_select on public.stocktake_lines;
create policy stocktake_lines_select on public.stocktake_lines
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- The counter writes counted_qty and nothing else. Everything the variance is
-- computed from is server-controlled, which is what makes the number mean
-- something.
drop policy if exists stocktake_lines_update on public.stocktake_lines;
create policy stocktake_lines_update on public.stocktake_lines
  for update using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  ) with check (org_id = (select public.current_org_id()));

revoke update on public.stocktakes from authenticated, anon;
grant update (scheduled_for, notes, updated_at) on public.stocktakes to authenticated;

revoke insert, update, delete on public.stocktake_lines from authenticated, anon;
grant update (counted_qty, variance_reason, note, updated_at)
  on public.stocktake_lines to authenticated;

-- ----------------------------------------------------------------- the RPCs

/**
 * Opens a stocktake and snapshots what the system currently believes.
 *
 * `p_product_ids` narrows a cycle or spot count; null means everything at the
 * location that has a balance row.
 */
create or replace function public.stocktake_open(
  p_location_id uuid,
  p_stocktake_type text default 'full',
  p_product_ids uuid[] default null,
  p_freeze boolean default false
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
  v_id uuid;
  v_number text;
  v_lines integer;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can open a stocktake.' using errcode = '42501';
  end if;
  if p_stocktake_type not in ('full', 'cycle', 'spot') then
    raise exception 'A stocktake is full, cycle or spot.' using errcode = '22023';
  end if;
  if p_freeze and p_stocktake_type <> 'full' then
    raise exception 'Only a full count may freeze the location.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.stock_locations
                 where id = p_location_id and org_id = v_org and active) then
    raise exception 'That location does not exist here.' using errcode = '42501';
  end if;

  -- One open count per location. Two people counting the same shelves against
  -- two different snapshots produces two variances for the same stock.
  if exists (select 1 from public.stocktakes
             where location_id = p_location_id and org_id = v_org
               and status in ('draft', 'counting', 'submitted')) then
    raise exception 'There is already a stocktake open at that location.'
      using errcode = '42501';
  end if;

  v_number := public.next_document_number(v_org, 'stocktake', 'STK');

  insert into public.stocktakes (
    org_id, stocktake_number, location_id, stocktake_type, status,
    freeze_movements, started_at, started_by, created_by)
  values (v_org, v_number, p_location_id, p_stocktake_type, 'counting',
          p_freeze, now(), auth.uid(), auth.uid())
  returning id into v_id;

  insert into public.stocktake_lines (
    org_id, stocktake_id, product_id, batch_id, system_qty_at_open)
  select v_org, v_id, b.product_id, b.batch_id, b.qty_on_hand
  from public.stock_balances b
  where b.org_id = v_org
    and b.location_id = p_location_id
    and (p_product_ids is null or b.product_id = any(p_product_ids));

  get diagnostics v_lines = row_count;

  return jsonb_build_object(
    'stocktake_id', v_id, 'stocktake_number', v_number,
    'status', 'counting', 'type', p_stocktake_type,
    'frozen', p_freeze, 'lines', v_lines);
end;
$$;

/**
 * Hands the sheet in. Re-reads the system quantity for every line, and that
 * second reading — not the one taken at open — is what the variance measures
 * against.
 */
create or replace function public.stocktake_submit(p_stocktake_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role text;
  v_st public.stocktakes;
  v_uncounted integer;
  v_variances integer;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();
  if v_role is null or v_role not in ('manager', 'warehouse') then
    raise exception 'Only warehouse staff can submit a stocktake.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('stocktake'), hashtext(p_stocktake_id::text));

  select * into v_st from public.stocktakes where id = p_stocktake_id and org_id = v_org;
  if not found then
    raise exception 'That stocktake does not exist.' using errcode = 'P0002';
  end if;
  if v_st.status <> 'counting' then
    raise exception 'Stocktake % is %, not being counted.',
      v_st.stocktake_number, v_st.status using errcode = '42501';
  end if;

  select count(*) into v_uncounted from public.stocktake_lines
  where stocktake_id = v_st.id and counted_qty is null;
  if v_uncounted > 0 then
    raise exception '% line(s) have not been counted yet.', v_uncounted using errcode = '22023';
  end if;

  -- The second reading. Anything that traded while the count was running is
  -- reflected here, so the variance is the difference the count actually found
  -- rather than the count plus a day of business.
  --
  -- A correlated subquery rather than a join, because a line whose balance row
  -- has since been deleted still needs a number: `coalesce(..., 0)` says the
  -- system now believes there are none, which is exactly what a join would have
  -- silently dropped.
  update public.stocktake_lines l
     set system_qty_at_submit = coalesce((
           select b.qty_on_hand from public.stock_balances b
           where b.org_id = v_org
             and b.location_id = v_st.location_id
             and b.product_id = l.product_id
             and b.batch_id is not distinct from l.batch_id
         ), 0),
         line_status = 'counted'
   where l.stocktake_id = v_st.id;

  update public.stocktakes
     set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
   where id = v_st.id;

  select count(*) into v_variances from public.stocktake_lines
  where stocktake_id = v_st.id and variance_qty <> 0;

  return jsonb_build_object(
    'stocktake_id', v_st.id, 'stocktake_number', v_st.stocktake_number,
    'status', 'submitted', 'lines_with_variance', v_variances);
end;
$$;

/**
 * A manager's decision on a submitted count.
 *
 * Approving posts one movement per line with a non-zero variance. Any line
 * whose live balance has moved since the sheet was handed in is refused, unless
 * its id appears in `p_reconfirm_line_ids` — which the UI only offers after
 * showing the manager both numbers.
 */
create or replace function public.stocktake_decide(
  p_stocktake_id uuid,
  p_approve boolean,
  p_note text default null,
  p_reconfirm_line_ids uuid[] default null
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
  v_st public.stocktakes;
  v_line record;
  v_live integer;
  v_up integer := 0;
  v_down integer := 0;
  v_lines integer := 0;
begin
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if v_role <> 'manager' then
    raise exception 'Only a manager can approve or reject a stocktake.' using errcode = '42501';
  end if;
  if not p_approve and (p_note is null or btrim(p_note) = '') then
    raise exception 'Say why the stocktake is being rejected.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('stocktake'), hashtext(p_stocktake_id::text));

  select * into v_st from public.stocktakes where id = p_stocktake_id and org_id = v_org;
  if not found then
    raise exception 'That stocktake does not exist.' using errcode = 'P0002';
  end if;
  if v_st.status <> 'submitted' then
    raise exception 'Stocktake % is %, not waiting for a decision.',
      v_st.stocktake_number, v_st.status using errcode = '42501';
  end if;

  if not p_approve then
    update public.stocktakes
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           decision_note = p_note
     where id = v_st.id;
    return jsonb_build_object('stocktake_id', v_st.id,
      'stocktake_number', v_st.stocktake_number, 'status', 'rejected');
  end if;

  for v_line in
    select l.*, p.name as product_name
    from public.stocktake_lines l
    join public.products p on p.id = l.product_id
    where l.stocktake_id = v_st.id and l.variance_qty is distinct from 0
    order by l.product_id, l.batch_id nulls first, l.id
  loop
    select coalesce(b.qty_on_hand, 0) into v_live
    from public.stock_balances b
    where b.org_id = v_org and b.location_id = v_st.location_id
      and b.product_id = v_line.product_id
      and b.batch_id is not distinct from v_line.batch_id;
    v_live := coalesce(v_live, 0);

    -- 🔴 The guard this whole design exists for. If the stock moved between
    -- submit and now, the variance on the sheet no longer describes reality,
    -- and posting it would double-count whatever moved.
    if v_live <> v_line.system_qty_at_submit
       and not (v_line.id = any(coalesce(p_reconfirm_line_ids, array[]::uuid[]))) then
      raise exception
        '% has moved since the count was handed in: it said % and now says %. Re-check that line before approving.',
        v_line.product_name, v_line.system_qty_at_submit, v_live
        using errcode = '23514';
    end if;

    if v_line.variance_qty > 0 then
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        to_location_id, to_bucket,
        reason, reference, note, source_doc_type, source_doc_id, source_line_id,
        actor_id, approved_by)
      values (
        v_org, v_line.product_id, v_line.batch_id, v_line.variance_qty,
        v_st.location_id, 'available',
        'stocktake_variance_increase', v_st.stocktake_number,
        v_line.variance_reason, 'stocktake', v_st.id, v_line.id,
        v_st.submitted_by, auth.uid());
      v_up := v_up + v_line.variance_qty;
    else
      insert into public.stock_movements (
        org_id, product_id, batch_id, qty,
        from_location_id, from_bucket,
        reason, reference, note, source_doc_type, source_doc_id, source_line_id,
        actor_id, approved_by)
      values (
        v_org, v_line.product_id, v_line.batch_id, abs(v_line.variance_qty),
        v_st.location_id, 'available',
        'stocktake_variance_decrease', v_st.stocktake_number,
        v_line.variance_reason, 'stocktake', v_st.id, v_line.id,
        v_st.submitted_by, auth.uid());
      v_down := v_down + abs(v_line.variance_qty);
    end if;

    update public.stocktake_lines set line_status = 'accepted' where id = v_line.id;
    v_lines := v_lines + 1;
  end loop;

  update public.stocktakes
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note, freeze_movements = false
   where id = v_st.id;

  return jsonb_build_object(
    'stocktake_id', v_st.id, 'stocktake_number', v_st.stocktake_number,
    'status', 'approved', 'lines_adjusted', v_lines,
    'units_added', v_up, 'units_removed', v_down);
end;
$$;

comment on function public.stocktake_decide(uuid, boolean, text, uuid[]) is
  'Manager decision on a submitted stocktake. Refuses any line whose balance moved since submit unless it is explicitly re-confirmed.';

/**
 * The variance report for a stocktake, for the screen the manager decides from.
 */
drop function if exists public.stocktake_variance_report(uuid);
create or replace function public.stocktake_variance_report(p_stocktake_id uuid)
returns table (
  line_id uuid,
  product_id uuid,
  product_name text,
  batch_number text,
  system_qty_at_open integer,
  counted_qty integer,
  system_qty_at_submit integer,
  variance_qty integer,
  live_qty integer,
  moved_since_submit boolean,
  variance_reason text,
  line_status text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (select public.current_org_id() as org)
  select
    l.id, l.product_id, p.name, pb.batch_number,
    l.system_qty_at_open, l.counted_qty, l.system_qty_at_submit, l.variance_qty,
    coalesce(b.qty_on_hand, 0)::integer,
    l.system_qty_at_submit is not null
      and coalesce(b.qty_on_hand, 0) <> l.system_qty_at_submit,
    l.variance_reason, l.line_status
  from public.stocktake_lines l
  cross join cfg
  join public.stocktakes s on s.id = l.stocktake_id
  join public.products p on p.id = l.product_id
  left join public.product_batches pb on pb.id = l.batch_id
  left join public.stock_balances b
    on b.org_id = cfg.org
   and b.location_id = s.location_id
   and b.product_id = l.product_id
   and b.batch_id is not distinct from l.batch_id
  where l.stocktake_id = p_stocktake_id
    and l.org_id = cfg.org
  order by (l.variance_qty is distinct from 0) desc, p.name;
$$;

revoke all on function public.stocktake_open(uuid, text, uuid[], boolean) from public, anon;
grant execute on function public.stocktake_open(uuid, text, uuid[], boolean) to authenticated;
revoke all on function public.stocktake_submit(uuid) from public, anon;
grant execute on function public.stocktake_submit(uuid) to authenticated;
revoke all on function public.stocktake_decide(uuid, boolean, text, uuid[]) from public, anon;
grant execute on function public.stocktake_decide(uuid, boolean, text, uuid[]) to authenticated;
revoke all on function public.stocktake_variance_report(uuid) from public, anon;
grant execute on function public.stocktake_variance_report(uuid) to authenticated;
revoke all on function public.stocktake_lines_enforce_org() from public, anon, authenticated;
revoke all on function public.stock_movements_respect_freeze() from public, anon, authenticated;
