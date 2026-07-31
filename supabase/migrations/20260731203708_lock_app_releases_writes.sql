-- Belt and braces on the table that decides what the fleet installs.
--
-- `app_releases` has RLS enabled with a SELECT-only policy, so writes from
-- clients are already refused. `security_events` and `service_flags` carry an
-- explicit revoke on top of the same arrangement; this table controls which
-- APK every rep's phone offers to install, and deserves the same second
-- layer. Publishing stays service-role only.
revoke insert, update, delete on public.app_releases from authenticated, anon;
