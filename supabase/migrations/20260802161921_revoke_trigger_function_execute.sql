-- Take EXECUTE off the ledger's trigger functions.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and PostgREST
-- exposes anything in the `public` schema. So the five trigger functions added
-- with the stock ledger were reachable as `/rest/v1/rpc/stock_movements_apply`
-- and friends, by `anon`, as SECURITY DEFINER. Supabase's advisor flags this as
-- `anon_security_definer_function_executable`, and it is right to.
--
-- It was not exploitable: Postgres refuses a trigger function invoked outside a
-- trigger ('trigger functions can only be called as triggers', 0A000), and that
-- was checked rather than assumed. But "the attack fails for a reason unrelated
-- to the permission" is not a permission model, and the next definer function
-- that is *not* a trigger would inherit the same default silently.
--
-- Triggers do not need the grant. A trigger function executes as part of the
-- statement that fired it, under the table owner's rights, and consults no
-- EXECUTE privilege at all — so revoking this costs nothing and closes the
-- whole class.
--
-- The same default applies to the trigger functions this database already had
-- (`log_profile_security_change`, `territories_enforce_shape`,
-- `stores_enforce_territory`, `territory_reps_enforce_org`, `leads_freeze_start`
-- and `log_assignment_change`). They are deliberately left alone here: they are
-- older, unrelated to this module, and each deserves its own look rather than
-- being swept up in a warehouse migration. The advisor will keep naming them.

revoke all on function public.stock_movements_apply() from public, anon, authenticated;
revoke all on function public.stock_movements_immutable() from public, anon, authenticated;
revoke all on function public.stock_movements_enforce_org() from public, anon, authenticated;
revoke all on function public.stock_locations_enforce_org() from public, anon, authenticated;
revoke all on function public.product_batches_enforce_org() from public, anon, authenticated;
