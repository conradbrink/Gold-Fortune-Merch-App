-- The Orders pipeline card's "Invoiced" no longer counts the day after the
-- range.
--
-- `dashboard_business` took invoices with `issue_date < (p_to local)::date + 1`.
-- p_to is exclusive, so for 1-31 August (p_to = 1 September, 00:00) invoices
-- dated 1 September were counted, and the card disagreed with the Money card.
-- Dropping the `+ 1` would lose today's invoices when the range ends now, so
-- the test is now "the invoice's day starts before the range ends", in the
-- company's time: it is right for a midnight end and for a mid-day one.

do $$
declare
  def text := pg_get_functiondef('public.dashboard_business(timestamptz,timestamptz)'::regprocedure);
  old_text constant text := 'issue_date < (p_to at time zone v_tz)::date + 1';
  new_text constant text := 'issue_date::timestamp < (p_to at time zone v_tz)';
  n int;
begin
  n := (length(def) - length(replace(def, old_text, ''))) / length(old_text);
  if n <> 1 then
    raise exception 'dashboard_business: expected 1 of the anchor, found %', n;
  end if;
  execute replace(def, old_text, new_text);
end;
$$;
