-- An edited quote saved in one step (after the review of #209).
--
-- The web saved an edited quote in several calls: its changed and new lines,
-- then the lines taken off, then its header. A dropped connection part-way
-- left a quote with some of the edit and not the rest, and the client's link
-- shows the quote live. quote_save() does it all in one transaction, so a
-- failed save changes nothing:
--
--   * the quote is locked and must still be a draft or sent, and unchanged
--     since the form loaded it (`updated_at`, which every save moves through
--     quotes_stamp), so a save never undoes somebody else's;
--   * a sent quote keeps its client: the link in the client's email shows the
--     quote as it is now and is reused on the next send, so a quote sent to
--     one client never becomes another's;
--   * its lines are replaced with the ones given, each under the id the
--     screen gave it (a saved line keeps its own).
--
-- The caller's own rights apply (security invoker): the quote policies, the
-- column grants, quote_lines_enforce_org, and the module and billing gates.

create function public.quote_save(p_quote uuid, p_loaded_at timestamptz, p_header jsonb, p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  q record;
  v_status text;
  v_n integer;
begin
  perform public.require_module('invoicing');
  perform public.require_writable();
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Who the quote is for is missing.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line before saving the quote.' using errcode = '22023';
  end if;

  select id, org_id, status, updated_at into q from public.quotes where id = p_quote for update;
  if not found then
    -- A converted quote is visible but cannot be locked for update.
    select status into v_status from public.quotes where id = p_quote;
    if v_status = 'converted' then
      raise exception 'This quote is already an order. Change the order instead.' using errcode = '42501';
    end if;
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;
  if q.status = 'accepted' then
    raise exception 'This quote was accepted. Reopen it on its page to change it; if it has been invoiced, void the invoices first.'
      using errcode = '42501';
  end if;
  if q.status not in ('draft', 'sent') then
    raise exception 'This quote was %. Reopen it on its page to change it.', q.status using errcode = '42501';
  end if;
  if p_loaded_at is null or q.updated_at is distinct from p_loaded_at then
    raise exception 'This quote was changed after you opened it, perhaps by someone else or by sending it. Reload the page to see it as it is now, then make your changes again.'
      using hint = 'stale';
  end if;

  update public.quotes
     set store_id = case when q.status = 'draft' then (p_header->>'store_id')::uuid else store_id end,
         customer_name = case when q.status = 'draft' then p_header->>'customer_name' else customer_name end,
         customer_address = case when q.status = 'draft' then p_header->>'customer_address' else customer_address end,
         contact_email = case when q.status = 'draft' then p_header->>'contact_email' else contact_email end,
         contact_name = p_header->>'contact_name',
         contact_phone = p_header->>'contact_phone',
         rep_id = (p_header->>'rep_id')::uuid,
         valid_until = (p_header->>'valid_until')::date,
         delivery_address = p_header->>'delivery_address',
         notes = p_header->>'notes'
   where id = q.id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'The quote was not saved. Reload the page to see where it stands.' using errcode = '42501';
  end if;

  delete from public.quote_lines where quote_id = q.id;
  insert into public.quote_lines
    (id, org_id, quote_id, position, product_id, service_item_id, description, unit, qty, list_price, discount_pct, discount_amount)
  select coalesce(nullif(x.l->>'id', '')::uuid, gen_random_uuid()), q.org_id, q.id, x.ord::integer,
         nullif(x.l->>'product_id', '')::uuid, nullif(x.l->>'service_item_id', '')::uuid,
         nullif(btrim(x.l->>'description'), ''), nullif(btrim(x.l->>'unit'), ''),
         (x.l->>'qty')::numeric, (x.l->>'list_price')::numeric,
         coalesce((x.l->>'discount_pct')::numeric, 0), coalesce((x.l->>'discount_amount')::numeric, 0)
    from jsonb_array_elements(p_lines) with ordinality as x(l, ord);
end;
$function$;

revoke all on function public.quote_save(uuid, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.quote_save(uuid, timestamptz, jsonb, jsonb) to authenticated;

insert into public.module_assignments (kind, name, module_code) values
  ('function', 'quote_save', 'invoicing');
