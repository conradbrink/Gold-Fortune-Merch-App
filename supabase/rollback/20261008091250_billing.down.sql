-- Rollback for billing: the plan, the charges, the invoices and the prices go.
-- Run the billing_gate rollback first. Companies keep everything else; their
-- trial dates stay (Stage 5). Invoices issued in the meantime are lost with
-- billing_invoices: export them before rolling back a billing that has taken
-- money.

delete from public.module_assignments
 where (kind = 'function' and name in (
          'my_account', 'billing_quote', 'billing_preview_change', 'billing_start_checkout',
          'billing_request_change', 'billing_set_cancel', 'billing_retry_now', 'billing_plan',
          'billing_record_payment', 'billing_record_failure', 'billing_prepare_due',
          'billing_operator_mark_paid', 'billing_operator_set_custom_price',
          'billing_operator_set_exempt', 'billing_operator_extend_trial',
          'billing_operator_credit_note', 'billing_operator_cancel_charge'))
    or (kind = 'table' and name in (
          'price_list', 'billing_counters', 'billing_charges', 'billing_invoices', 'billing_payments'));

drop trigger profiles_user_limit on public.profiles;
drop function public.profiles_user_limit();

drop function public.billing_operator_cancel_charge(uuid, uuid);
drop function public.billing_operator_credit_note(uuid, bigint, text, uuid);
drop function public.billing_operator_extend_trial(uuid, integer, uuid);
drop function public.billing_operator_set_exempt(uuid, boolean, integer, uuid);
drop function public.billing_operator_set_custom_price(uuid, bigint, uuid);
drop function public.billing_operator_mark_paid(uuid, text, uuid);
drop function public.billing_audit(uuid, text, uuid, jsonb);
drop function public.billing_prepare_due(timestamptz);
drop function public.billing_record_failure(uuid, text, text, text, jsonb);
drop function public.billing_record_payment(uuid, text, bigint, text, text, jsonb);
drop function public.billing_apply_addons(uuid, jsonb, text[]);
drop function public.billing_issue_invoice(uuid, text, uuid, uuid, jsonb, bigint, timestamptz, timestamptz, text, text, text);
drop function public.billing_retry_now();
drop function public.billing_set_cancel(boolean);
drop function public.billing_request_change(integer, jsonb);
drop function public.billing_start_checkout(text, integer, jsonb, text);
drop function public.billing_preview_change(integer, jsonb);
drop function public.billing_quote(text, integer, jsonb);
drop function public.my_account();
drop function public.billing_change_lines(uuid, jsonb, timestamptz);
drop function public.billing_remaining_share(timestamptz, timestamptz, timestamptz);
drop function public.billing_plan(integer, jsonb);
drop function public.billing_my_org();
drop function public.billing_vat(bigint);
drop function public.billing_lines(uuid, text, jsonb, boolean);
drop function public.billing_seats_used(uuid, jsonb);
drop function public.platform_setting(text);

alter table public.billing_charges drop constraint billing_charges_invoice_fk;
drop table public.billing_payments;
drop table public.billing_invoices;
drop table public.billing_charges;
drop table public.billing_counters;
drop table public.price_list;

-- company_account as Stage 5 left it: the columns, and the table-wide read.
alter table public.company_account
  drop constraint company_account_plan_shape,
  drop constraint company_account_period_order,
  drop column status, drop column period, drop column plan, drop column plan_next,
  drop column custom_price_cents, drop column period_start, drop column period_end,
  drop column setup_charged, drop column provider, drop column provider_token,
  drop column billing_email, drop column grace_ends_at, drop column read_only_since,
  drop column cancel_at_period_end;
-- Column grants outlive a table-level revoke, so the six that remain are
-- revoked by name.
revoke select (org_id, trial_ends_at, onboarding_dismissed_at, onboarding_dismissed_by, created_at, updated_at)
  on public.company_account from authenticated;
grant select on public.company_account to authenticated;

delete from public.platform_settings where key in (
  'seller_name', 'seller_address', 'seller_email', 'seller_vat_number', 'vat_rate',
  'invoice_prefix', 'credit_note_prefix', 'billing_item_name', 'retry_days', 'grace_days',
  'read_only_days', 'trial_user_limit');
