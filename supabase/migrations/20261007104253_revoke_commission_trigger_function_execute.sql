-- The three trigger functions from 20261007101603_sales_targets_and_commissions
-- were left executable by PUBLIC, so anon and authenticated could call them
-- directly. Postgres refuses to run a trigger function outside a trigger, but
-- they are SECURITY DEFINER; revoked as the earlier trigger functions were.
revoke all on function public.order_lines_snapshot_cost() from public, anon, authenticated;
revoke all on function public.commission_on_order_change() from public, anon, authenticated;
revoke all on function public.commission_on_line_change() from public, anon, authenticated;
