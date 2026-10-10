-- Rollback of 20261010270000_billing_gate_newer_tables: drops the gate from
-- the tables that migration gated (the ones made after 8 October 2026).

do $$
declare
  t text;
begin
  foreach t in array array['alert_digests', 'alert_reads', 'alerts', 'document_links', 'document_sends',
                           'job_report_evenings', 'job_reports', 'message_outbox', 'message_suppressions']
  loop
    if to_regclass('public.' || quote_ident(t)) is not null then
      execute format('drop policy if exists billing_gate_insert on public.%I', t);
      execute format('drop policy if exists billing_gate_update on public.%I', t);
      execute format('drop policy if exists billing_gate_delete on public.%I', t);
    end if;
  end loop;
end;
$$;
