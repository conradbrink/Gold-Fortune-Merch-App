-- Rollback of 20261031154700_store_add_from_phone_suburb: store_add_from_phone
-- goes back to 20261029161300's text, which saves the town as typed and leaves
-- the area empty. Customers already added keep the suburb and area they got.

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

  insert into public.stores (
    id, org_id, name, address, city, lat, lng, store_group_id,
    geocode_source, geocoded_at, geocode_accuracy_m)
  values (
    p_store_id, v_org, v_name, v_address, v_city, p_lat, p_lng, p_store_group_id,
    case when p_lat is not null then 'rep' end,
    case when p_lat is not null then now() end,
    case when p_lat is not null and p_accuracy_m >= 0 then p_accuracy_m end);

  return jsonb_build_object('store_id', p_store_id, 'already_added', false);
end;
$function$;

comment on function public.store_add_from_phone(
  uuid, text, text, text, double precision, double precision, double precision, uuid) is
  'A rep adds a new customer from the phone (id made on the phone, so it is safe to replay). Insert only: name, delivery address, town, position and price group.';
