-- Quotes: a priced offer to a store that becomes an order only when accepted.
--
-- ------------------------------------------------- why not an order status
--
-- An order is a promise the warehouse acts on. Confirming reserves stock, the
-- dashboard counts it, the rep scorecards value it, and the status graph and
-- column grants on `orders` exist so that nothing moves stock by accident. A
-- quote is none of that, and giving `orders` a 'quote' state would mean every
-- one of those readers learning to look past it — the one that forgets
-- reports revenue nobody has agreed to pay.
--
-- So a quote lives in its own two tables, and `quote_convert` turns an
-- accepted one into an ordinary `new` order, through the same inserts and the
-- same policies a clerk keying an order goes through. From that moment the
-- warehouse sees an order and nothing else.
--
-- ------------------------------------------------------------- pricing
--
-- The same shape as order lines after 20261007095133: a VAT-exclusive list
-- price and a discount percentage, with the net derived. Here the net is a
-- generated column, because nothing has to stay compatible with an older
-- writer. VAT is stamped from the organisation when the quote is written, for
-- the reason `orders.vat_rate` is: a quote the customer is holding should not
-- change its total because somebody changed a setting.
--
-- ------------------------------------------------------------ who
--
-- Whoever can work orders (`warehouse`) sees and writes every quote; a rep
-- sees and writes the quotes on which they are the rep. Nothing deletes a
-- quote that has been converted — the order points back at it.

-- Quote numbers come from the same gapless counter as every other document
-- (QT-000001), which only admits the types it lists.
alter table public.document_counters drop constraint if exists document_counters_type_check;
alter table public.document_counters add constraint document_counters_type_check
  check (doc_type in ('goods_receipt', 'order', 'dispatch', 'transfer', 'adjustment',
                      'stocktake', 'disciplinary_case', 'quote'));

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quote_number text not null,

  store_id uuid not null references public.stores(id) on delete restrict,
  contact_name text,
  contact_phone text,
  rep_id uuid references public.profiles(id) on delete set null,

  status text not null default 'draft',
  valid_until date,
  delivery_address text,
  notes text,
  vat_rate numeric(6,3) not null default 0,

  converted_order_id uuid references public.orders(id) on delete set null,
  converted_at timestamptz,

  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quotes is
  'Priced offers to a store. Never seen by the warehouse; quote_convert turns an accepted one into a new order.';

alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check
  check (status in ('draft', 'sent', 'accepted', 'declined', 'converted'));

-- Converted and pointing at an order are the same fact, stated twice so that a
-- hand edit cannot make them disagree.
alter table public.quotes drop constraint if exists quotes_converted_has_order;
alter table public.quotes add constraint quotes_converted_has_order
  check ((status = 'converted') = (converted_order_id is not null));

create unique index if not exists quotes_org_number_key
  on public.quotes (org_id, quote_number);
create index if not exists quotes_org_created_idx
  on public.quotes (org_id, created_at desc);

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty integer not null check (qty > 0),
  list_price numeric(12,2) not null check (list_price >= 0),
  discount_pct numeric(5,2) not null default 0
    check (discount_pct >= 0 and discount_pct <= 100),
  -- The same rounding order_lines_apply_discount uses, so a converted line
  -- lands at exactly the price that was quoted.
  unit_price numeric(12,2) generated always as
    (round(list_price * (1 - discount_pct / 100), 2)) stored,
  created_at timestamptz not null default now()
);

create unique index if not exists quote_lines_quote_product_key
  on public.quote_lines (quote_id, product_id);

-- ------------------------------------------------------------ triggers

create or replace function public.quotes_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(vat_rate, 0) into new.vat_rate
    from public.organizations where id = new.org_id;
  else
    -- Frozen like orders.vat_rate: written once, never restated.
    new.vat_rate := old.vat_rate;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quotes_stamp on public.quotes;
create trigger quotes_stamp
  before insert or update on public.quotes
  for each row execute function public.quotes_stamp();

create or replace function public.quote_lines_enforce_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_status text;
begin
  select org_id, status into v_org, v_status from public.quotes
  where id = coalesce(new.quote_id, old.quote_id);
  if tg_op <> 'DELETE' and v_org is distinct from new.org_id then
    raise exception 'That quote belongs to another organisation.' using errcode = '42501';
  end if;
  if v_status = 'converted' then
    raise exception 'This quote is already an order. Change the order instead.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists quote_lines_enforce_org on public.quote_lines;
create trigger quote_lines_enforce_org
  before insert or update or delete on public.quote_lines
  for each row execute function public.quote_lines_enforce_org();

-- ------------------------------------------------------------ RLS

alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;

drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes
  for select using (
    org_id = (select public.current_org_id())
    and ((select public.has_permission('warehouse')) or rep_id = (select auth.uid()))
  );

drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes
  for insert with check (
    org_id = (select public.current_org_id())
    and status = 'draft'
    and converted_order_id is null
    and ((select public.has_permission('warehouse')) or rep_id = (select auth.uid()))
  );

drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes
  for update using (
    org_id = (select public.current_org_id())
    and status <> 'converted'
    and ((select public.has_permission('warehouse')) or rep_id = (select auth.uid()))
  ) with check (
    org_id = (select public.current_org_id())
    and ((select public.has_permission('warehouse')) or rep_id = (select auth.uid()))
  );

drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes
  for delete using (
    org_id = (select public.current_org_id())
    and status <> 'converted'
    and ((select public.has_permission('warehouse')) or rep_id = (select auth.uid()))
  );

-- Lines follow their quote: whoever may see or change the quote may do the
-- same to its lines.
drop policy if exists quote_lines_all on public.quote_lines;
create policy quote_lines_all on public.quote_lines
  for all using (
    org_id = (select public.current_org_id())
    and exists (select 1 from public.quotes q where q.id = quote_lines.quote_id)
  ) with check (
    org_id = (select public.current_org_id())
    and exists (select 1 from public.quotes q where q.id = quote_lines.quote_id)
  );

-- A column REVOKE does nothing against a table-level grant, so the table grant
-- is narrowed instead, the way `orders` does it: everything a person edits on a
-- quote, and not the number, the frozen VAT rate, or the link to the order —
-- those belong to the triggers and to `quote_convert`.
grant select, insert, delete on public.quotes to authenticated;
revoke update on public.quotes from authenticated, anon;
grant update (
  store_id, contact_name, contact_phone, rep_id, status, valid_until,
  delivery_address, notes
) on public.quotes to authenticated;

grant select, insert, delete on public.quote_lines to authenticated;
revoke update on public.quote_lines from authenticated, anon;
grant update (product_id, qty, list_price, discount_pct)
  on public.quote_lines to authenticated;

-- ------------------------------------------------------------ convert

/**
 * Links a quote to the order made from it. Called by `quote_convert` only.
 *
 * Definer, because `converted_order_id` is not granted to anybody. That makes
 * it callable on its own, so it checks what conversion would have guaranteed:
 * the caller may update the quote (the same test as `quotes_update`), the
 * order is a `new` order for the same store in the same organisation, and no
 * other quote already claims it.
 */
create or replace function public.quote_mark_converted(p_quote_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found
     or q.org_id is distinct from public.current_org_id()
     or q.status = 'converted'
     or not (public.has_permission('warehouse') or q.rep_id = auth.uid()) then
    raise exception 'You cannot convert this quote.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.org_id = q.org_id
      and o.store_id = q.store_id and o.status = 'new'
  ) or exists (select 1 from public.quotes where converted_order_id = p_order_id) then
    raise exception 'That order was not made from this quote.' using errcode = '42501';
  end if;
  update public.quotes
     set status = 'converted', converted_order_id = p_order_id, converted_at = now()
   where id = p_quote_id;
end;
$$;

revoke execute on function public.quote_mark_converted(uuid, uuid) from public, anon;
grant execute on function public.quote_mark_converted(uuid, uuid) to authenticated;

/**
 * Turns a quote into a new order and returns the order's id.
 *
 * Invoker, not definer: the order is inserted as the caller, so the policies
 * on `orders` and `order_lines` decide whether this person may place it,
 * exactly as they do for an order keyed by hand. A rep who may quote but not
 * place a warehouse order is refused here rather than let through.
 *
 * The quote row is locked first, so two people pressing Convert at once make
 * one order, not two.
 */
create or replace function public.quote_convert(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  q public.quotes;
  v_order uuid;
  v_number text;
begin
  -- Read first, lock second. `for update` is checked against the update
  -- policy, which hides a converted quote, so locking alone would answer
  -- "not found" to the second person pressing Convert instead of naming the
  -- order the first one made. Re-read after the lock, because that second
  -- person waited on it and the quote may have changed underneath them.
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;
  perform 1 from public.quotes where id = p_quote_id for update;
  select * into q from public.quotes where id = p_quote_id;
  if q.status = 'converted' then
    raise exception 'This quote is already order %.',
      (select order_number from public.orders where id = q.converted_order_id)
      using errcode = '23505';
  end if;
  if q.status = 'declined' then
    raise exception 'This quote was declined. Reopen it before converting it.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.quote_lines where quote_id = q.id) then
    raise exception 'This quote has no products on it.' using errcode = '22023';
  end if;

  v_number := public.next_document_number(q.org_id, 'order', 'SO');

  insert into public.orders (
    org_id, order_number, store_id, source, received_via,
    contact_name, contact_phone, rep_id, delivery_address, notes,
    client_generated_id
  ) values (
    q.org_id, v_number, q.store_id, 'warehouse_manual', 'other',
    q.contact_name, q.contact_phone, q.rep_id, q.delivery_address,
    concat_ws(E'\n', 'From quote ' || q.quote_number || '.', q.notes),
    gen_random_uuid()
  ) returning id into v_order;

  insert into public.order_lines (
    org_id, order_id, product_id, qty_ordered,
    unit_price, list_price, discount_pct, client_generated_id
  )
  select q.org_id, v_order, l.product_id, l.qty,
         l.list_price, l.list_price, l.discount_pct, gen_random_uuid()
  from public.quote_lines l
  where l.quote_id = q.id;

  perform public.quote_mark_converted(q.id, v_order);

  return v_order;
end;
$$;

grant execute on function public.quote_convert(uuid) to authenticated;
