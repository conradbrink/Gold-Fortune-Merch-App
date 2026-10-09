-- Rollback of 20261009160000_job_reports: the scheduled sends, the job
-- reports with their signatures, and the two settings, out again. Emails
-- already queued stay in the outbox.

select cron.unschedule('job-reports');

delete from public.module_assignments
 where (kind = 'table' and name = 'job_reports')
    or (kind = 'function' and name in ('send_job_report', 'job_report_for_visit'));

drop function if exists public.job_report_sign(uuid, text, text, text, text);
drop function if exists public.job_report_opened(uuid);
drop function if exists public.job_report_view(uuid);
drop function if exists public.job_report_for_visit(uuid);
drop function if exists public.send_job_report(uuid);
drop function if exists public.queue_job_reports();
drop function if exists public.queue_job_report_emails(uuid, uuid, uuid[], text);
drop function if exists public.ensure_job_report(uuid);

drop table if exists public.job_reports;

delete from public.company_settings where key in ('job_report_send', 'job_report_send_time');
delete from public.template_settings where setting_key in ('job_report_send', 'job_report_send_time');
delete from public.setting_definitions where key in ('job_report_send', 'job_report_send_time');
