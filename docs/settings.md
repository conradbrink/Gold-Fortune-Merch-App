# Settings: what an owner configures, and what Tickd keeps

Owners configure their business, not the software. Every setting is either a
business decision (on Company settings, in plain words) or Tickd's own
configuration (changed only by the platform operator, refused by the database
from a customer). Nothing was deleted: an internal setting keeps its key, its
value and every reader it had.

- The catalogue: `setting_definitions`, with `audience` = `owner` or `internal`
  (migration `20261010390000_internal_settings`).
- Enforcement: restrictive policies `company_settings_owner_keys_insert` and
  `company_settings_owner_keys_update`; tested by
  `supabase/tests/settings_audience.sql`.
- The tabs: `web/lib/settings-tabs.ts`; tests in `web/tests/settings.test.ts`
  (every owner setting has a screen, no customer screen writes an internal one,
  old `?tab=` links still land).
- The operator: `/platform/companies/<id>`, section "Tickd settings"
  (`setCompanySetting`, logged in `platform_audit_log`).

## Admin

| Page | Tabs | Who |
|------|------|-----|
| People & permissions (`/settings/users`) | People · Roles and permissions | `admin` |
| Company settings (`/settings/company`) | Company · Operations · Billing · Communications · Branding · Plan | `company_settings` |
| HR settings (`/hr/settings`), a tab beside Company settings | Working hours · Leave types · Departments · Performance · Disciplinary | `hr_settings`, HR module on |
| Warehouse settings (`/warehouse/settings`), a tab beside Company settings | Suppliers · Drivers · Vehicles · Locations · Reorder levels · Warehouse staff (last three for `warehouse_approve`) | `warehouse`, Distribution or Warehouse module on |

Permissions on the Roles screen are shown only for modules the company has
(`permissionsForCompany`); grants already held are untouched.

## Every setting

Company columns (`organizations`) and company settings (`company_settings`).

| Setting | Who needs it | Why it exists | Customer? | Where it lives |
|---------|--------------|---------------|-----------|----------------|
| name, legal_name, industry, website, address, phone | Owner | Who the company is; printed on documents | Yes | Company → Company details |
| support_email | Owner | Replies to the emails Tickd sends | Yes | Company → Company details ("Email for {clients}") |
| country_code | Owner | Finding addresses on the map | Yes | Company → Where you work |
| currency_code | Owner | Money on screen, documents, exports | Yes | Company → Where you work |
| timezone | Owner | Which day something happened on | Yes | Company → Where you work |
| registration_number, tax_number, vat_number | Owner | Printed on tax invoices | Yes | Company → Registration and tax numbers (registration number moved from Billing) |
| working_days, stores_per_day, default_visit_frequency | Owner, manager | What the schedule is measured against | Yes | Operations → Planning |
| auto_end_enabled, auto_end_time | Owner | Forgotten workdays do not count all night | Yes | Operations → Workdays and check-ins |
| checkin_radius_m | Owner | How close counts as on site (big premises need more) | Yes, as plain choices (50 to 500 m) | Operations → Workdays and check-ins |
| short_visit_minutes | Owner | When a visit is too short to be real | Yes | Operations → Workdays and check-ins |
| report_short_day_hours, report_long_day_hours, report_day_normal_hours, report_week_normal_hours, report_sunday_is_overtime | Owner | Labour rules on the Hours report | Yes | Operations → Working hours and overtime |
| dashboard_cards | Owner | The numbers everyone sees first | Yes | Operations → Dashboard numbers |
| money_workflow, money_quotes, money_deposits, money_invoice_from_jobs, money_invoice_direct, money_contracts | Owner | How the company gets paid | Yes | Billing → How you get paid |
| vat_rate, invoice_terms_days, invoice_footer, prices_include_vat, quote_validity_days, invoice_prefix, quote_prefix, bank_details | Owner | What goes on quotes and invoices | Yes | Billing → On your quotes and invoices (VAT rate, terms and footer moved from Company) |
| document_style | Owner | How documents look | Yes | Billing → How your documents look |
| job_report_send, job_report_send_time | Owner | Reports to clients | Yes | Communications → Emails |
| alerts_on, alerts_email, alerts_digest_time, alerts_patrol_gap_minutes | Owner | What to be told about, and how | Yes, with the alerts module | Communications → Alerts |
| brand_primary_color, brand_accent_color, logo_path, terminology | Owner | How the company looks and talks | Yes | Branding |
| gps_ping_interval_minutes | Tickd | How often the phone records its position | **No** | Operator: Tickd settings |
| off_site_distance_m | Tickd | When a check-in counts as off site | **No** | Operator: Tickd settings |
| invalid_gps_distance_m | Tickd | When a position is a bad GPS fix | **No** | Operator: Tickd settings |
| report_tabs | Tickd | Which reports a trade gets (already per trade) | **No** | Operator: Tickd settings |
| staff_score_weights | Tickd | The staff score's formula | **No** | Operator: Tickd settings |
| dashboard_layout | Tickd | The trade's starting dashboard (each person arranges their own with Customise) | **No** | Operator: Tickd settings |
| modules | Tickd | What the plan includes | Read only | Plan (switched by the operator) |

## Removed from Company settings (nothing deleted)

- **Field settings tab:** a plain box per leftover setting, including the GPS
  ones and two duplicates (staff score weights, document style). Its business
  settings are now on Operations in plain words.
- **Team members tab:** the same people as People & permissions. `?tab=team`
  opens People & permissions.
- **Dashboard & reports tab:** dashboard numbers and working hours are on
  Operations; report tabs and score weights are Tickd's.
