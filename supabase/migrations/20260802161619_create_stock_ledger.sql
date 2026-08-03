-- The stock ledger. Everything else in this module is a way of writing to it.
--
-- ------------------------------------------------------- shape of the thing
--
-- `stock_movements` is append-only and is the truth. `stock_balances` is a
-- cache of its running totals, maintained by a trigger inside the same
-- transaction as the movement that changed it. Nothing else writes the cache;
-- nothing reads the ledger to answer "how many are there".
--
-- The two obvious alternatives were both rejected, for reasons worth recording
-- because they will look attractive again later:
--
--   * Derive the balance on read (sum the ledger, or a materialised view).
--     Then `available >= 0` cannot be a constraint, because you cannot
--     constrain an aggregate; and the oversell guard cannot be a row lock,
--     because there is no row to lock. Both of those are load-bearing below.
--   * Keep a mutable balance and log changes beside it. Then two writers must
--     agree by convention, with no arithmetic relationship between them, and
--     the day one path forgets to log there is nothing that can notice. This
--     database already made that argument once, for `security_events`.
--
-- --------------------------------------------------------------- two legs
--
-- A movement has a from-leg and a to-leg, each a (location, bucket) pair.
-- `qty` is always positive: the direction lives in the legs, never in the sign,
-- so no reader can get it backwards. A null leg means the stock crossed the
-- system boundary — arrived from a supplier, went out with a customer — and
-- only a reason on an explicit list is allowed to do that. Conservation of
-- stock is therefore a property of the schema rather than a habit of the code.
--
--   goods receipt        null            -> wh/available
--   order confirmed      wh/available    -> wh/reserved
--   dispatched           wh/reserved     -> van/in_transit
--   delivered            van/in_transit  -> null
--   damage found         wh/available    -> wh/damaged
--   transfer out         whA/available   -> whB/in_transit
--
-- ----------------------------------------------------------- seven buckets
--
-- Six are stored as columns; `on_hand` is generated from five of them.
-- `in_transit` is deliberately left out of `on_hand`: that stock has physically
-- left, and counting it at the place it left would double it against the place
-- it is going.
--
-- Buckets are columns and a ledger dimension — not separate locations, because
-- damaged and good stock sit in the same building and treating them as two
-- places would make every location report wrong; and not separate tables,
-- because then the non-negative check could not sit next to the reservation
-- that decrements it.
--
-- ADDING A BUCKET IS A FIVE-PART CHANGE, ALL IN ONE MIGRATION: the column on
-- `stock_balances`, the `qty_on_hand` expression, the non-negative constraint,
-- the CASE arms in `stock_movements_apply()`, and the bucket list in
-- `stock_balance_drift()`. Miss the trigger arm and the quantity is silently
-- dropped on the floor — no error, just a smaller number.
--
-- ------------------------------------------------------------- what is *not* here
--
-- Nothing pending. An adjustment awaiting a manager's approval is not a
-- movement with a status; it is a row in `stock_adjustment_lines`, and approval
-- is what posts the movement. A status column on the ledger would mean every
-- reader had to remember to filter it, and the first one that forgot would
-- produce a number that was wrong and looked fine.

-- ---------------------------------------------------------- stock_movements

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.product_batches(id) on delete restrict,

  qty integer not null,

  from_location_id uuid references public.stock_locations(id) on delete restrict,
  from_bucket text,
  to_location_id uuid references public.stock_locations(id) on delete restrict,
  to_bucket text,

  reason text not null,
  -- Human-facing: an order number, a GRN number, a supplier invoice. The thing
  -- a person would quote when asking why this happened.
  reference text,
  note text,
  -- Machine-facing: what document caused it, so the audit trail can join back.
  source_doc_type text not null,
  source_doc_id uuid,
  source_line_id uuid,

  -- When the stock actually moved, which is not always when it was keyed.
  occurred_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.stock_movements is
  'Append-only ledger of every stock movement. The source of truth; stock_balances is a cache of its totals. Correct a mistake by posting the opposite movement, never by editing.';

alter table public.stock_movements drop constraint if exists stock_movements_qty_positive;
alter table public.stock_movements add constraint stock_movements_qty_positive
  check (qty > 0);

alter table public.stock_movements drop constraint if exists stock_movements_bucket_check;
alter table public.stock_movements add constraint stock_movements_bucket_check
  check (
    (from_bucket is null or from_bucket in
      ('available','reserved','damaged','expired','in_transit','promotional'))
    and (to_bucket is null or to_bucket in
      ('available','reserved','damaged','expired','in_transit','promotional'))
  );

-- A leg is a (location, bucket) pair or nothing at all. Half a leg is a bug,
-- and one that would otherwise reach the trigger and be silently ignored.
alter table public.stock_movements drop constraint if exists stock_movements_leg_shape;
alter table public.stock_movements add constraint stock_movements_leg_shape
  check (
    (from_location_id is null) = (from_bucket is null)
    and (to_location_id is null) = (to_bucket is null)
  );

-- At least one leg, and never a movement from somewhere to itself.
alter table public.stock_movements drop constraint if exists stock_movements_has_effect;
alter table public.stock_movements add constraint stock_movements_has_effect
  check (
    (from_location_id is not null or to_location_id is not null)
    and not (
      from_location_id is not distinct from to_location_id
      and from_bucket is not distinct from to_bucket
    )
  );

-- Stock may only be created or destroyed for a reason that says so out loud.
-- Everything else must have both legs, and therefore conserves.
alter table public.stock_movements drop constraint if exists stock_movements_boundary_check;
alter table public.stock_movements add constraint stock_movements_boundary_check
  check (
    (from_location_id is not null and to_location_id is not null)
    or reason in (
      'opening_stock','goods_receipt','grn_correction','customer_return',
      'order_delivery','transfer_loss','adjustment_write_off',
      'stocktake_variance_increase','stocktake_variance_decrease'
    )
  );

alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (
    reason in (
      'opening_stock','goods_receipt','grn_correction',
      'order_reservation','order_reservation_release',
      'order_pick','order_pick_undo','order_dispatch','order_delivery',
      'order_return_undelivered','customer_return',
      'transfer_out','transfer_in','transfer_loss',
      'adjustment_damage','adjustment_expiry','adjustment_promotional',
      'adjustment_missing','adjustment_found','adjustment_write_off',
      'adjustment_other',
      'stocktake_variance_increase','stocktake_variance_decrease',
      'batch_reallocation'
    )
  );

alter table public.stock_movements drop constraint if exists stock_movements_source_check;
alter table public.stock_movements add constraint stock_movements_source_check
  check (
    source_doc_type in
      ('goods_receipt','order','dispatch','transfer','adjustment','stocktake','system')
  );

-- Backdating is allowed and necessary — yesterday's delivery keyed this morning
-- is an honest record. Post-dating is not: a movement that has not happened yet
-- would be counted in a balance that claims to be current. The minute of slack
-- absorbs clock skew between the client and the database.
alter table public.stock_movements drop constraint if exists stock_movements_not_future;
alter table public.stock_movements add constraint stock_movements_not_future
  check (occurred_at <= now() + interval '1 minute');

create index if not exists stock_movements_org_time_idx
  on public.stock_movements (org_id, occurred_at desc);
create index if not exists stock_movements_product_idx
  on public.stock_movements (org_id, product_id, occurred_at desc);
create index if not exists stock_movements_from_idx
  on public.stock_movements (from_location_id, product_id)
  where from_location_id is not null;
create index if not exists stock_movements_to_idx
  on public.stock_movements (to_location_id, product_id)
  where to_location_id is not null;
create index if not exists stock_movements_source_idx
  on public.stock_movements (source_doc_type, source_doc_id);
create index if not exists stock_movements_batch_idx
  on public.stock_movements (batch_id) where batch_id is not null;

-- ----------------------------------------------------------- stock_balances

create table if not exists public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.product_batches(id) on delete restrict,

  qty_available integer not null default 0,
  qty_reserved integer not null default 0,
  qty_damaged integer not null default 0,
  qty_expired integer not null default 0,
  qty_in_transit integer not null default 0,
  qty_promotional integer not null default 0,

  qty_on_hand integer generated always as (
    qty_available + qty_reserved + qty_damaged + qty_expired + qty_promotional
  ) stored,

  updated_at timestamptz not null default now()
);

comment on table public.stock_balances is
  'Running totals per location, product and batch. A cache of stock_movements, written only by stock_movements_apply(). See that migration''s header before adding a bucket.';
comment on column public.stock_balances.qty_on_hand is
  'Physically present here, whatever its condition. Excludes in_transit, which has left.';

-- Named, so `on conflict on constraint` can name it. `nulls not distinct` is
-- what lets every untracked product share one batch_id-null row instead of
-- getting a fresh row per receipt.
alter table public.stock_balances drop constraint if exists stock_balances_grain_key;
alter table public.stock_balances add constraint stock_balances_grain_key
  unique nulls not distinct (org_id, location_id, product_id, batch_id);

-- The single most important line in the module. Every oversell that gets past
-- every RPC dies here with a 23514 rather than becoming negative stock.
alter table public.stock_balances drop constraint if exists stock_balances_non_negative;
alter table public.stock_balances add constraint stock_balances_non_negative
  check (
    qty_available >= 0 and qty_reserved >= 0 and qty_damaged >= 0
    and qty_expired >= 0 and qty_in_transit >= 0 and qty_promotional >= 0
  );

create index if not exists stock_balances_org_product_idx
  on public.stock_balances (org_id, product_id);
create index if not exists stock_balances_location_idx
  on public.stock_balances (location_id, product_id);
-- The "what can I sell" scan.
create index if not exists stock_balances_available_idx
  on public.stock_balances (org_id, location_id, product_id)
  where qty_available > 0;

-- --------------------------------------------------------------- the trigger

/**
 * Applies a posted movement to the balance cache.
 *
 * The only writer of stock_balances. Write privileges on both tables are
 * revoked from `authenticated` and `anon` below, and movements are posted only
 * by SECURITY DEFINER RPCs, so there is exactly one arithmetic path from a
 * movement to a number on a screen.
 */
create or replace function public.stock_movements_apply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.from_location_id is not null then
    update public.stock_balances b
       set qty_available   = b.qty_available   - (case when new.from_bucket = 'available'   then new.qty else 0 end),
           qty_reserved    = b.qty_reserved    - (case when new.from_bucket = 'reserved'    then new.qty else 0 end),
           qty_damaged     = b.qty_damaged     - (case when new.from_bucket = 'damaged'     then new.qty else 0 end),
           qty_expired     = b.qty_expired     - (case when new.from_bucket = 'expired'     then new.qty else 0 end),
           qty_in_transit  = b.qty_in_transit  - (case when new.from_bucket = 'in_transit'  then new.qty else 0 end),
           qty_promotional = b.qty_promotional - (case when new.from_bucket = 'promotional' then new.qty else 0 end),
           updated_at = now()
     where b.org_id      = new.org_id
       and b.location_id = new.from_location_id
       and b.product_id  = new.product_id
       -- `is not distinct from`, never `=`. batch_id is nullable, and a plain
       -- equality here would silently match nothing for every untracked
       -- product — no error, just stock that refuses to move.
       and b.batch_id is not distinct from new.batch_id;

    if not found then
      raise exception
        'There is no stock of that product at that location to move.'
        using errcode = '23514';
    end if;
  end if;

  if new.to_location_id is not null then
    insert into public.stock_balances as b (
      org_id, location_id, product_id, batch_id,
      qty_available, qty_reserved, qty_damaged,
      qty_expired, qty_in_transit, qty_promotional
    )
    values (
      new.org_id, new.to_location_id, new.product_id, new.batch_id,
      case when new.to_bucket = 'available'   then new.qty else 0 end,
      case when new.to_bucket = 'reserved'    then new.qty else 0 end,
      case when new.to_bucket = 'damaged'     then new.qty else 0 end,
      case when new.to_bucket = 'expired'     then new.qty else 0 end,
      case when new.to_bucket = 'in_transit'  then new.qty else 0 end,
      case when new.to_bucket = 'promotional' then new.qty else 0 end
    )
    -- Two receipts landing the same new batch at the same instant must add,
    -- not collide. This is the only place a balance row is ever created.
    on conflict on constraint stock_balances_grain_key do update
      set qty_available   = b.qty_available   + excluded.qty_available,
          qty_reserved    = b.qty_reserved    + excluded.qty_reserved,
          qty_damaged     = b.qty_damaged     + excluded.qty_damaged,
          qty_expired     = b.qty_expired     + excluded.qty_expired,
          qty_in_transit  = b.qty_in_transit  + excluded.qty_in_transit,
          qty_promotional = b.qty_promotional + excluded.qty_promotional,
          updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists stock_movements_apply_balance on public.stock_movements;
create trigger stock_movements_apply_balance
  after insert on public.stock_movements
  for each row execute function public.stock_movements_apply();

/**
 * A posted movement is a statement about a moment, and the moment has passed.
 *
 * Correcting one means posting its opposite, not editing history — the rule
 * visits and leads already carry. `service_role` and direct SQL stay exempt so
 * a deliberate repair remains possible out of band, which is also how the
 * balance would be rebuilt if it ever drifted.
 */
create or replace function public.stock_movements_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return coalesce(new, old);
  end if;
  raise exception
    'A stock movement cannot be changed once posted. Post a reversing movement instead.'
    using errcode = '42501';
end;
$$;

drop trigger if exists stock_movements_no_rewrite on public.stock_movements;
create trigger stock_movements_no_rewrite
  before update or delete on public.stock_movements
  for each row execute function public.stock_movements_immutable();

/**
 * A movement's product, batch and locations all belong to its organisation.
 *
 * Foreign keys prove existence, not ownership. Without this, a movement could
 * name another tenant's warehouse and move stock across the boundary while
 * every constraint above was satisfied.
 */
create or replace function public.stock_movements_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.products where id = new.product_id;
  if v_org is distinct from new.org_id then
    raise exception 'That product belongs to another organisation.' using errcode = '42501';
  end if;

  if new.batch_id is not null then
    select org_id into v_org from public.product_batches where id = new.batch_id;
    if v_org is distinct from new.org_id then
      raise exception 'That batch belongs to another organisation.' using errcode = '42501';
    end if;
  end if;

  if new.from_location_id is not null then
    select org_id into v_org from public.stock_locations where id = new.from_location_id;
    if v_org is distinct from new.org_id then
      raise exception 'That location belongs to another organisation.' using errcode = '42501';
    end if;
  end if;

  if new.to_location_id is not null then
    select org_id into v_org from public.stock_locations where id = new.to_location_id;
    if v_org is distinct from new.org_id then
      raise exception 'That location belongs to another organisation.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists stock_movements_org_guard on public.stock_movements;
create trigger stock_movements_org_guard
  before insert on public.stock_movements
  for each row execute function public.stock_movements_enforce_org();

-- ---------------------------------------------------------------------- RLS
--
-- Read-only to everyone, at every level. Neither table has an insert, update or
-- delete policy, and the privileges are revoked underneath as well — belt and
-- braces, because an audit trail a user can write by hand is not an audit
-- trail. The transactional RPCs run as definer and are the only writers.

alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements
  for select using (
    org_id = (select public.current_org_id())
    and (select public."current_role"()) in ('manager', 'warehouse')
  );

-- Warehouse and managers see the whole estate. A rep sees exactly one place:
-- their own van. That is what will make the phone's van-stock screen possible
-- without a second pass over these policies.
--
-- The `exists` reads stock_locations, whose own policy does not read back here,
-- so there is no cycle — unlike the files/file_reps pair that once produced
-- 'infinite recursion detected in policy'.
drop policy if exists stock_balances_select on public.stock_balances;
create policy stock_balances_select on public.stock_balances
  for select using (
    org_id = (select public.current_org_id())
    and (
      (select public."current_role"()) in ('manager', 'warehouse')
      or exists (
        select 1 from public.stock_locations l
        where l.id = stock_balances.location_id
          and l.type = 'rep'
          and l.rep_id = (select auth.uid())
      )
    )
  );

revoke insert, update, delete on public.stock_movements from authenticated, anon;
revoke insert, update, delete on public.stock_balances from authenticated, anon;

-- ------------------------------------------------------------- the invariant

/**
 * Every place the cached balance disagrees with the ledger.
 *
 * Returning zero rows is this module's core invariant. If it ever returns a
 * row, the ledger is right and the balance is what needs rebuilding — never the
 * other way round.
 *
 * Manager-only, because it is a diagnostic about the integrity of the system
 * rather than a number anyone works from.
 */
drop function if exists public.stock_balance_drift();
create or replace function public.stock_balance_drift()
returns table (
  location_id uuid,
  product_id uuid,
  batch_id uuid,
  bucket text,
  cached bigint,
  ledger bigint,
  drift bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org, public."current_role"() as role
  ),
  legs as (
    select m.to_location_id as location_id, m.product_id, m.batch_id,
           m.to_bucket as bucket, m.qty::bigint as qty
      from public.stock_movements m cross join cfg
     where m.org_id = cfg.org and cfg.role = 'manager'
       and m.to_location_id is not null
    union all
    select m.from_location_id, m.product_id, m.batch_id, m.from_bucket, -m.qty::bigint
      from public.stock_movements m cross join cfg
     where m.org_id = cfg.org and cfg.role = 'manager'
       and m.from_location_id is not null
  ),
  from_ledger as (
    select l.location_id, l.product_id, l.batch_id, l.bucket, sum(l.qty) as qty
      from legs l group by 1, 2, 3, 4
  ),
  from_cache as (
    select b.location_id, b.product_id, b.batch_id, v.bucket, v.qty::bigint as qty
      from public.stock_balances b cross join cfg
      cross join lateral (values
        ('available',   b.qty_available),
        ('reserved',    b.qty_reserved),
        ('damaged',     b.qty_damaged),
        ('expired',     b.qty_expired),
        ('in_transit',  b.qty_in_transit),
        ('promotional', b.qty_promotional)
      ) as v(bucket, qty)
     where b.org_id = cfg.org and cfg.role = 'manager'
  )
  select coalesce(l.location_id, c.location_id),
         coalesce(l.product_id,  c.product_id),
         coalesce(l.batch_id,    c.batch_id),
         coalesce(l.bucket,      c.bucket),
         coalesce(c.qty, 0),
         coalesce(l.qty, 0),
         coalesce(c.qty, 0) - coalesce(l.qty, 0)
    from from_ledger l
    full join from_cache c
      on  c.location_id = l.location_id
      and c.product_id  = l.product_id
      and c.batch_id is not distinct from l.batch_id
      and c.bucket      = l.bucket
   where coalesce(c.qty, 0) is distinct from coalesce(l.qty, 0);
$$;

comment on function public.stock_balance_drift() is
  'Reconciles stock_balances against stock_movements. Must return zero rows; a row means the cache has drifted and should be rebuilt from the ledger.';

revoke all on function public.stock_balance_drift() from public, anon;
grant execute on function public.stock_balance_drift() to authenticated;
