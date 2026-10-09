-- Rollback of 20261009150000_messaging_and_site_contacts: the outbox, the
-- suppressions, the site contacts and their functions, out again. Anything
-- queued or sent is lost with them.

delete from public.module_assignments
 where (kind = 'table' and name in ('site_contacts', 'message_outbox', 'message_suppressions'))
    or (kind = 'function' and name = 'send_test_email');

drop function if exists public.send_test_email();
drop function if exists public.unsubscribe_message(uuid);
drop function if exists public.record_message_event(text, text);
drop function if exists public.finish_message(uuid, boolean, text, text, boolean, boolean);
drop function if exists public.claim_messages(integer);
drop function if exists public.queue_email(uuid, text, text, text, jsonb, text, uuid, timestamptz);
drop function if exists public.email_allowed(uuid, text);

drop table if exists public.message_suppressions;
drop table if exists public.message_outbox;
drop table if exists public.site_contacts;
