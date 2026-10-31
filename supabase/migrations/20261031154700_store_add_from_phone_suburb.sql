-- A customer added on the phone lands in its suburb and its area:
-- store_add_from_phone() matches the town the rep gave to the company's own
-- suburbs.
--
-- Until now the function saved the town as the rep typed it ("MITCHELL S
-- PLAIN", "Mitchell S PLAIN WESTRIDGE", "TABLEVIEW") and left territory_id
-- empty, so every customer a rep added was missing from area-based planning
-- until someone in the office placed it by hand. On 31 Oct 2026 one
-- distributor had about ninety of them tidied that way, and the next day's
-- adds arrived the same.
--
-- The phone now offers the company's own suburbs to pick from: the towns of
-- customers that are already in an area. Here:
--
--   * The town is matched to those suburbs ignoring case, spaces and
--     punctuation, so "mitchells plain", "MITCHELL'S PLAIN" and the phone's
--     pick all land on the company's own spelling.
--   * A town that has a suburb inside it ("Mitchell S PLAIN WESTRIDGE") is
--     matched on the whole words that spell the suburb, the longest that do.
--     The words left over (Westridge, the part of town) go on the end of the
--     address, where the driver reads them, unless the address says so
--     already. Phones still on an older build send what the rep typed, so this
--     is what places their customers.
--   * The area is the one most of that suburb's customers are in. Only areas
--     a customer can be placed in count (an active area, not a region), so the
--     insert can never be refused for the area it was given.
--   * A town that matches nothing is kept as typed with no area, as before.
--
-- The office can still change the town and the area afterwards; the rep
-- still does not choose the area.

create or replace function public.store_add_from_phone(
  p_store_id uuid,
  p_name text,
  p_address text,
  p_city text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_store_group_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_role text;
  v_existing public.stores;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_address text := btrim(coalesce(p_address, ''));
  v_city text := nullif(regexp_replace(btrim(coalesce(p_city, '')), '\s+', ' ', 'g'), '');
  v_suburb text;
  v_territory uuid;
  v_rest text;
begin
  perform public.require_writable();
  perform public.require_module('distribution');
  v_org := public.current_org_id();
  v_role := public."current_role"();

  if v_org is null
     or not (v_role in ('rep', 'manager') or public.has_permission('warehouse')) then
    raise exception 'Adding a customer needs a rep, manager or warehouse login.'
      using errcode = '42501';
  end if;
  if p_store_id is null then
    raise exception 'The customer needs an id from the phone.' using errcode = '22023';
  end if;

  -- A retry after a lost reply: the customer is there already.
  select * into v_existing from public.stores where id = p_store_id;
  if found then
    if v_existing.org_id <> v_org then
      raise exception 'That customer cannot be added.' using errcode = '42501';
    end if;
    return jsonb_build_object('store_id', v_existing.id, 'already_added', true);
  end if;

  if v_name = '' then
    raise exception 'What is the shop called?' using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'That name is too long.' using errcode = '22023';
  end if;
  if v_address = '' then
    raise exception 'Where do we deliver? The delivery address is needed.' using errcode = '22023';
  end if;
  if char_length(v_address) > 300 or char_length(coalesce(v_city, '')) > 80 then
    raise exception 'That address is too long.' using errcode = '22023';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That position is not a place on the map.' using errcode = '22023';
  end if;
  if p_store_group_id is not null
     and not exists (select 1 from public.store_groups
                      where id = p_store_group_id and org_id = v_org) then
    raise exception 'That price group is not one of your company''s.' using errcode = '22023';
  end if;

  -- The suburb: the longest run of whole words in the town that spells one of
  -- the company's suburbs, letters and digits only. Its spelling and its area
  -- are the ones most of its customers have.
  if v_city is not null then
    with words as (
      select w.word, w.n, lower(regexp_replace(w.word, '[^[:alnum:]]+', '', 'g')) as k
        from unnest(regexp_split_to_array(v_city, '[[:space:],/]+')) with ordinality as w(word, n)
    ), runs as (
      select a.n as i, b.n as j, string_agg(x.k, '' order by x.n) as k
        from words a
        join words b on b.n >= a.n
        join words x on x.n between a.n and b.n
       group by a.n, b.n
    ), known as (
      select lower(regexp_replace(s.city, '[^[:alnum:]]+', '', 'g')) as k,
             s.city, s.territory_id, count(*) as stores
        from public.stores s
        join public.territories t on t.id = s.territory_id
       where s.org_id = v_org
         and t.org_id = v_org
         and t.level = 'territory'
         and t.active
         and s.city is not null
       group by 1, 2, 3
    ), best as (
      select r.i, r.j, r.k
        from runs r
       where r.k <> ''
         and exists (select 1 from known where known.k = r.k)
       order by length(r.k) desc, r.i
       limit 1
    )
    select (select k.city from known k where k.k = b.k
             group by k.city order by sum(k.stores) desc, k.city limit 1),
           (select k.territory_id from known k where k.k = b.k
             group by k.territory_id order by sum(k.stores) desc, k.territory_id limit 1),
           (select string_agg(w.word, ' ' order by w.n) from words w
             where (w.n < b.i or w.n > b.j) and w.k <> '')
      into v_suburb, v_territory, v_rest
      from best b;

    if v_suburb is not null then
      v_city := v_suburb;
      v_rest := btrim(coalesce(v_rest, ''));
      -- Typed all in capitals or all in small letters: Westridge, not WESTRIDGE.
      if v_rest = upper(v_rest) or v_rest = lower(v_rest) then
        v_rest := initcap(v_rest);
      end if;
      if v_rest <> ''
         and strpos(lower(v_address), lower(v_rest)) = 0
         and char_length(v_address) + 2 + char_length(v_rest) <= 300 then
        v_address := v_address || ', ' || v_rest;
      end if;
    end if;
  end if;

  insert into public.stores (
    id, org_id, name, address, city, territory_id, lat, lng, store_group_id,
    geocode_source, geocoded_at, geocode_accuracy_m)
  values (
    p_store_id, v_org, v_name, v_address, v_city, v_territory, p_lat, p_lng, p_store_group_id,
    case when p_lat is not null then 'rep' end,
    case when p_lat is not null then now() end,
    case when p_lat is not null and p_accuracy_m >= 0 then p_accuracy_m end);

  return jsonb_build_object('store_id', p_store_id, 'already_added', false);
end;
$function$;

comment on function public.store_add_from_phone(
  uuid, text, text, text, double precision, double precision, double precision, uuid) is
  'A rep adds a new customer from the phone (id made on the phone, so it is safe to replay). Insert only: name, delivery address, town, position and price group. The town is matched to the company''s own suburbs, which gives the area.';
