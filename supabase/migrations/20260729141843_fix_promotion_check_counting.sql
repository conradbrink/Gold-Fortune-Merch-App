-- Count each line once, and say when a promotion was never ranged.
--
-- Three defects in the two report functions as first written, all found before
-- anything read them.
--
-- **1. Repeat visits were double-counted.** `answered` used
-- `count(distinct product_id)` while running/not_running/not_stocked used a
-- plain `count(*) filter`. A promotion runs for a month and a store is visited
-- weekly, so several rows per (store, line) is the designed-for case, not an
-- edge one — the schema comment says corrections belong to the next visit
-- rather than to an update. A store answering "not running" in week one and
-- "running" in week two counted in both, and the three statuses summed higher
-- than the number of lines. Reducing to the latest answer per (store, line)
-- also makes `stores_running` mean "has it up now" rather than "ever had it
-- up", which is what the phrase is read as.
--
-- **2. Detaching a line left its answers behind.** The check's foreign key is
-- to `products`, not to `promotion_products`, so removing a line from a live
-- promotion orphaned its checks. `answered` could then exceed the line count
-- and every outlet flipped to fully checked. Both functions now join through
-- `promotion_products`, so the answer set follows the promotion's current
-- shape.
--
-- **3. A promotion nobody ranges looked exactly like one everybody fails.**
-- Both read `stores_checked = 30, stores_running = 0`. Those are the two
-- different conversations with two different people that the third status
-- exists to separate — a buyer's ranging problem is not a rep's compliance
-- problem — so the summary now carries `stores_not_stocked` and the caller can
-- tell them apart without opening the promotion.
create or replace function public.promotion_summaries()
returns table (
  promotion_id       uuid,
  name               text,
  brief              text,
  starts_on          date,
  ends_on            date,
  active             boolean,
  products           int,
  stores             int,
  stores_checked     int,
  stores_running     int,
  stores_not_stocked int,
  last_checked_at    timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  prod as (
    select pp.promotion_id, count(*)::int as n
    from promotion_products pp group by pp.promotion_id
  ),
  st as (
    select ps.promotion_id, count(*)::int as n
    from promotion_stores ps group by ps.promotion_id
  ),
  -- One row per (promotion, store, line): the most recent answer, and only for
  -- lines the promotion still covers.
  latest as (
    select distinct on (pc.promotion_id, pc.store_id, pc.product_id)
           pc.promotion_id, pc.store_id, pc.product_id, pc.status, pc.checked_at
    from promotion_checks pc
    cross join cfg
    join promotion_products pp
      on pp.promotion_id = pc.promotion_id and pp.product_id = pc.product_id
    where pc.org_id = cfg.org
    order by pc.promotion_id, pc.store_id, pc.product_id, pc.checked_at desc
  ),
  per_store as (
    select l.promotion_id, l.store_id,
           count(*)::int                                          as answered,
           count(*) filter (where l.status = 'running')::int       as running,
           count(*) filter (where l.status = 'not_running')::int   as not_running,
           count(*) filter (where l.status = 'not_stocked')::int   as not_stocked,
           max(l.checked_at)                                       as last_at
    from latest l
    group by l.promotion_id, l.store_id
  ),
  rolled as (
    select ps.promotion_id,
           count(*) filter (
             where ps.answered >= coalesce(
               (select n from prod where prod.promotion_id = ps.promotion_id), 0)
           )::int as stores_checked,
           count(*) filter (where ps.running > 0)::int as stores_running,
           -- Nothing up, nothing failing, and something not carried: the outlet
           -- was never a candidate for this promotion in the first place.
           count(*) filter (
             where ps.not_stocked > 0 and ps.running = 0 and ps.not_running = 0
           )::int as stores_not_stocked,
           max(ps.last_at) as last_at
    from per_store ps
    group by ps.promotion_id
  )
  select p.id, p.name, p.brief, p.starts_on, p.ends_on, p.active,
         coalesce(prod.n, 0), coalesce(st.n, 0),
         coalesce(rolled.stores_checked, 0), coalesce(rolled.stores_running, 0),
         coalesce(rolled.stores_not_stocked, 0),
         rolled.last_at
  from promotions p
  cross join cfg
  left join prod   on prod.promotion_id = p.id
  left join st     on st.promotion_id = p.id
  left join rolled on rolled.promotion_id = p.id
  where p.org_id = cfg.org
  order by p.active desc, p.ends_on desc, p.name;
$$;

comment on function public.promotion_summaries is
  'One row per promotion, counting each covered line once at its most recent answer: how many outlets have answered for every line, how many have it running, and how many simply do not carry it.';

create or replace function public.promotion_store_status(p_promotion_id uuid)
returns table (
  store_id     uuid,
  store_name   text,
  city         text,
  answered     int,
  running      int,
  not_running  int,
  not_stocked  int,
  last_checked_at timestamptz,
  rep_name     text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cfg as materialized (
    select public.current_org_id() as org
  ),
  latest as (
    select distinct on (pc.store_id, pc.product_id)
           pc.store_id, pc.product_id, pc.status, pc.checked_at, pc.rep_id
    from promotion_checks pc
    cross join cfg
    join promotion_products pp
      on pp.promotion_id = pc.promotion_id and pp.product_id = pc.product_id
    where pc.org_id = cfg.org and pc.promotion_id = p_promotion_id
    order by pc.store_id, pc.product_id, pc.checked_at desc
  ),
  answers as (
    select l.store_id,
           count(*)::int                                        as answered,
           count(*) filter (where l.status = 'running')::int     as running,
           count(*) filter (where l.status = 'not_running')::int as not_running,
           count(*) filter (where l.status = 'not_stocked')::int as not_stocked,
           max(l.checked_at) as last_at,
           -- Whoever answered most recently. A store can be visited by more
           -- than one rep over a promotion's life.
           (array_agg(l.rep_id order by l.checked_at desc))[1] as last_rep
    from latest l
    group by l.store_id
  )
  select s.id, s.name, s.city,
         coalesce(a.answered, 0), coalesce(a.running, 0),
         coalesce(a.not_running, 0), coalesce(a.not_stocked, 0),
         a.last_at, pr.full_name
  from promotion_stores ps
  join stores s on s.id = ps.store_id
  cross join cfg
  left join answers a on a.store_id = s.id
  left join profiles pr on pr.id = a.last_rep
  where ps.promotion_id = p_promotion_id
    and s.org_id = cfg.org
  order by coalesce(a.answered, 0), s.name;
$$;

comment on function public.promotion_store_status is
  'Per covered outlet for one promotion, each line counted once at its most recent answer. Outlets with no answer sort first, because that is the list worth acting on.';
