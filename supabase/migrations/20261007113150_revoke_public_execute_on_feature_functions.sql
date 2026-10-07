-- Four functions from today's feature migrations kept PostgreSQL's default
-- EXECUTE-to-PUBLIC grant, so anon could call them. All four are security
-- invoker, so a caller gets nothing it could not already do (anon has no
-- organisation, and every table behind them is RLS-gated), but nothing here is
-- meant for anon. The trigger functions need no caller at all; quote_convert
-- keeps its explicit grant to authenticated; recurring_next_date is only
-- called by the definer-owned recurring_order_place.
--
-- Checked after applying, rolled back: a quote still converts (100 less 10%
-- became 90.00), the sales_targets touch trigger still fires, and the morning
-- run still places a due recurring order and moves its date on.
revoke all on function public.order_lines_apply_discount() from public, anon, authenticated;
revoke all on function public.sales_targets_touch() from public, anon, authenticated;
revoke all on function public.recurring_next_date(date, text) from public, anon, authenticated;
revoke all on function public.quote_convert(uuid) from public, anon;
grant execute on function public.quote_convert(uuid) to authenticated;
