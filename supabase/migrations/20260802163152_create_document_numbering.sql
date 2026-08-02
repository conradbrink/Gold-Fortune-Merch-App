-- Human-readable reference numbers, one counter per organisation per document.
--
-- Goods receipts, orders, dispatches, transfers, adjustments and stocktakes all
-- need a short reference a person can say down a phone: "GRN-000014", not a
-- uuid. This is the one place that mints them, so the format is decided once.
--
-- ------------------------------------------------- why not a plain sequence
--
-- A Postgres sequence is per-database, not per-organisation, so a second tenant
-- would see the numbering jump and be able to infer the first tenant's volume.
-- Sequences are also non-transactional by design: a rolled-back order still
-- consumes its number, leaving gaps. Gaps are defensible for an order, but a
-- goods received note with holes in the sequence is the kind of thing an
-- auditor asks about, and "the database does that" is a poor answer.
--
-- A counter row is transactional. Roll the transaction back and the number is
-- returned. The cost is that two clerks creating a receipt at the same instant
-- serialise on one row for the microseconds it takes to increment — at this
-- volume that is free, and it is the behaviour that makes the sequence gapless.
--
-- ------------------------------------------------------- on the format
--
-- PREFIX-NNNNNN, zero-padded to six. No year segment: a year in the number
-- means deciding what happens on 1 January, and every answer is worse than not
-- having it. Six digits is a million documents per organisation, and the format
-- widens gracefully past that rather than breaking — `lpad` stops padding, it
-- does not truncate.

create table if not exists public.document_counters (
  org_id uuid not null references public.organizations(id) on delete cascade,
  doc_type text not null,
  next_value bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (org_id, doc_type)
);

comment on table public.document_counters is
  'One gapless counter per organisation per document type. Written only by next_document_number().';

alter table public.document_counters drop constraint if exists document_counters_type_check;
alter table public.document_counters add constraint document_counters_type_check
  check (doc_type in (
    'goods_receipt', 'order', 'dispatch', 'transfer', 'adjustment', 'stocktake'
  ));

alter table public.document_counters drop constraint if exists document_counters_positive;
alter table public.document_counters add constraint document_counters_positive
  check (next_value > 0);

/**
 * The next reference for a document type, and the only thing that advances it.
 *
 * SECURITY DEFINER because the counter table has no write policy at all — a
 * caller who could set the counter could mint a duplicate reference, and every
 * uniqueness guarantee downstream rests on this being the sole issuer.
 *
 * The caller's organisation is resolved here rather than taken as an argument,
 * so there is no version of this that can be pointed at somebody else's
 * counter. The RPCs that use it are themselves definer and pass their own
 * already-verified org, which is why the parameter exists — but it is checked
 * against the caller unless the caller is the service role.
 */
create or replace function public.next_document_number(
  p_org_id uuid,
  p_doc_type text,
  p_prefix text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_next bigint;
  v_caller_org uuid;
begin
  if p_prefix is null or p_prefix !~ '^[A-Z]{2,6}$' then
    raise exception 'A document prefix must be two to six capital letters.'
      using errcode = '22023';
  end if;

  -- A signed-in caller may only draw from their own organisation's counter.
  -- Trigger-free background work (service_role, direct SQL) is exempt, which is
  -- how a seed or a repair script can mint numbers for any tenant.
  if auth.uid() is not null then
    v_caller_org := public.current_org_id();
    if v_caller_org is null or v_caller_org is distinct from p_org_id then
      raise exception 'You cannot draw a document number for another organisation.'
        using errcode = '42501';
    end if;
  end if;

  -- One statement, so the row lock is held for as short a time as possible and
  -- two concurrent callers cannot both read the same value. `on conflict` makes
  -- the first ever call for a type create the counter rather than needing a
  -- seed for every org × type pair.
  --
  -- The column stores the *next* number to issue, so the number being issued
  -- now is always one less than the row's new value. That holds on both paths:
  -- a fresh counter is written as 2 having just issued 1, and an existing one
  -- goes from n to n+1 having just issued n. `returning` on an upsert always
  -- reports the new row, so one expression covers both.
  insert into public.document_counters as c (org_id, doc_type, next_value)
  values (p_org_id, p_doc_type, 2)
  on conflict (org_id, doc_type) do update
    set next_value = c.next_value + 1,
        updated_at = now()
  returning c.next_value - 1 into v_next;

  return p_prefix || '-' || lpad(v_next::text, 6, '0');
end;
$$;

comment on function public.next_document_number(uuid, text, text) is
  'Mints the next gapless reference for a document type, e.g. GRN-000014. The only writer of document_counters.';

-- No policies, and the privileges are revoked underneath: the table is written
-- only through the definer function above, exactly as rate_limits is.
alter table public.document_counters enable row level security;
revoke all on public.document_counters from authenticated, anon;

revoke all on function public.next_document_number(uuid, text, text) from public, anon;
grant execute on function public.next_document_number(uuid, text, text) to authenticated;
