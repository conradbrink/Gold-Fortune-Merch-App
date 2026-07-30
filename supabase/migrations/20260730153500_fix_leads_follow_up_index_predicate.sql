-- `leads_follow_up_idx` was built for a query that was never written.
--
-- Its predicate is `follow_up_required and status = 'completed'`, but the
-- follow-up counts that actually shipped — `dashboard_operations`,
-- `follow_ups_due` and `follow_ups_overdue` — filter on `follow_up_required`,
-- `follow_up_on` and `stage not in ('converted','lost')`, and never look at
-- `status` at all. A partial index whose predicate the query does not imply
-- cannot be used, so both counts were sequential scans against an index that
-- looked like it covered them.
--
-- Aligned with the shipped query. `follow_up_on is not null` is added to the
-- predicate as well: the query requires it, and it keeps rows that carry a tick
-- but no date out of the index.
drop index if exists public.leads_follow_up_idx;

create index leads_follow_up_idx on public.leads (org_id, follow_up_on)
  where follow_up_required
    and follow_up_on is not null
    and stage not in ('converted', 'lost');
