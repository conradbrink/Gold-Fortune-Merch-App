-- Rollback of 20261009170000_alerts: the scheduled detection, the alerts with
-- their read marks and digests, the four settings, and the module back to
-- unbuilt, switched on for nobody and named only by the security template, as
-- it was. Emails already queued stay in the outbox.

select cron.unschedule('alerts-detect');

delete from public.module_assignments
 where (kind = 'table' and name in ('alerts', 'alert_reads', 'alert_digests'))
    or (kind = 'function' and name in ('my_alerts', 'mark_alerts_read'));

drop function if exists public.mark_alerts_read(uuid[]);
drop function if exists public.my_alerts(integer);
drop function if exists public.detect_alerts();
drop function if exists public.queue_alert_emails(uuid);
drop function if exists public.alert_email_payload(uuid, uuid[]);
drop function if exists public.alert_recipients(uuid);
drop function if exists public.detect_company_alerts(uuid);

drop table if exists public.alert_reads;
drop table if exists public.alert_digests;
drop table if exists public.alerts;

delete from public.company_settings
 where key in ('alerts_on', 'alerts_email', 'alerts_digest_time', 'alerts_patrol_gap_minutes');
delete from public.template_settings
 where setting_key in ('alerts_on', 'alerts_email', 'alerts_digest_time', 'alerts_patrol_gap_minutes');
delete from public.setting_definitions
 where key in ('alerts_on', 'alerts_email', 'alerts_digest_time', 'alerts_patrol_gap_minutes');

-- No company could have the module on before (company_modules_guard refuses
-- an unbuilt one), so every row switched on is this migration's or came
-- after it; a row switched off means the same as no row.
delete from public.company_modules where module_code = 'owner_notifications';
-- The security template named it from the start (20261007182242).
delete from public.template_modules where module_code = 'owner_notifications' and template_code <> 'security';
update public.modules set is_built = false where code = 'owner_notifications';
