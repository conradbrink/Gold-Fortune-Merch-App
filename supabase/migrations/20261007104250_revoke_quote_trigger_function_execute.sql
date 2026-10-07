-- The two trigger functions from 20261007095715_quotes were left executable by
-- PUBLIC (the default for a new function), so anon and authenticated could
-- call them directly. Postgres refuses to run a trigger function outside a
-- trigger, but they are SECURITY DEFINER and the advisor is right to flag them;
-- same treatment as 20260802 revoke_trigger_function_execute gave the others.
--
-- Checked after applying: the triggers still fire for a signed-in manager
-- (a quote stamped VAT 14%), and a direct call is refused with 42501.
revoke all on function public.quotes_stamp() from public, anon, authenticated;
revoke all on function public.quote_lines_enforce_org() from public, anon, authenticated;
