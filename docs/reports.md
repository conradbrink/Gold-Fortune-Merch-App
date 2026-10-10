# Reports: fewer categories, more inside each

The Reports page (`/reports`) answers the questions an owner asks. Each
report is made of views, and the views are the reports Tickd already had:
the same tables, database functions, permissions and exports. One
configuration serves every trade: `web/lib/report-catalogue.ts`. Tests:
`web/tests/report-catalogue.test.ts`.

| Service trades | Answers | Views |
|---|---|---|
| Performance | How is the business doing? | Summary (figures, {jobs} per day, by {staff}, manager briefing) · By {site} (coverage) |
| Service | What work happened? | Completed {jobs} · Missed |
| Team | How is each {staff} doing? | {Staff} (scores; a name opens their full report) · Hours |
| Compliance | Did they do what was planned? | {Staff} adherence (with planned, done and missed figures, and links to off-site check-ins and activity) |
| Evidence | Can you prove it? | Proof of service (PDF and report to the {client}) · Photos · Forms |

| Distribution | Answers | Views |
|---|---|---|
| Performance | How is the sales operation doing? | Summary (Perfect Store, out of stock, coverage, adherence, audits, standards over time, by rep) |
| Perfect Store | Are stores meeting your standards? | Scores · Over time |
| Availability | Are products on the shelf? | Out of stock |
| Team | How is each rep doing? | Reps (a name opens their full report) |
| Coverage | Are you reaching every store? | Stores |
| Compliance | Are reps following the plan? | Rep adherence |
| Evidence | (kept: the audits' photos and forms) | Photos · Forms |

Sales, Targets and Warehouse insights stay pages of their own beside Reports.

## Old report → new home

| Old tab (`report_tabs` id) | Now | Data (unchanged) |
|---|---|---|
| Perfect {Site} (`score`) | Perfect Store → Scores | `perfect_store_score` |
| Out of stock (`oos`) | Availability → Out of stock | `oos_hotspots` |
| Coverage (`coverage`) | Service: Performance → By {site}. Distribution: Coverage | `coverage_gaps` |
| Adherence (`adherence`) | Compliance; also Service → Missed and the summary | `schedule_adherence` |
| {Staff} (`reps`) | Team → {Staff} | `staff_score_inputs` or `rep_scorecard` |
| Trends (`trends`) | Perfect Store → Over time, and the distributor's summary | `compliance_trends` |
| Form (`form`) | Evidence → Forms | `form_report`, `form_response_rows` |
| Photos (`photos`) | Evidence → Photos | `form_report` |
| Proof of service (`service_log`) | Evidence → Proof of service; also Service → Completed and the summary | `service_log`, `job_reports` |
| Hours (`hours`) | Team → Hours; also the summary and by {staff} | `staff_hours` |
| {Staff} performance page | A name on Team or the summary (`?rep=&from=&to=`) | `rep_performance_*` |

## What did not change

- **Each company's configuration.** `report_tabs` (now one of Tickd's own
  settings) still decides what a company sees: a view is shown when the old tab
  it grew from is in the company's list. No database change.
- **Permissions.** Every view calls the same functions, each guarded by
  `require_module` and `require_permission('insights')`; the page needs
  `insights` and the reports module.
- **Exports.** Every old export is still there, on its view. New views export
  too: the summary's figures, completed {jobs}, missed {jobs}.
- **Old links.** `?tab=adherence`, `?tab=service_log` and the rest open the view
  they became; `?tab=<report>&view=<view>` is the new form. A link to something
  a company does not have opens the nearest view that answers it, else
  Performance.
- **Filters.** Each view shows only the filters it uses (`viewFilters`); a
  filter the next view ignores is cleared when switching, so it never narrows
  a report silently.
