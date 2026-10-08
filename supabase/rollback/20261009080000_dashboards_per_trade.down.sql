-- Rollback of 20261009080000_dashboards_per_trade: the numbers, the quote
-- dates, the two dashboard settings and the trend's company days, out again.
-- Quotes lose when they were sent and decided; nothing else they hold.

delete from public.module_assignments
 where kind = 'function' and name in ('dashboard_kpis', 'dashboard_kpi_window');
drop function if exists public.dashboard_kpis(timestamptz, timestamptz, text[]);
drop function if exists public.dashboard_kpi_window(date, date, date, uuid[], boolean, boolean);

drop trigger if exists quotes_stamp_status on public.quotes;
drop function if exists public.quotes_stamp_status();
alter table public.quotes
  drop column if exists decided_at,
  drop column if exists sent_at;

delete from public.company_settings where key in ('dashboard_cards', 'dashboard_layout');
delete from public.template_settings where setting_key in ('dashboard_cards', 'dashboard_layout');
delete from public.setting_definitions where key in ('dashboard_cards', 'dashboard_layout');

do $rollback$
declare
  v_def text := pg_get_functiondef('public.dashboard_summary(timestamptz, timestamptz)'::regprocedure);
  c_new1 constant text := $b$           p_from - (p_to - p_from) as prev_from,
           public.org_timezone(public.current_org_id()) as tz
  ),$b$;
  c_old1 constant text := $a$           p_from - (p_to - p_from) as prev_from
  ),$a$;
  c_new2 constant text := $b$    cross join lateral generate_series((cfg.cur_from at time zone cfg.tz)::date,
                                       ((cfg.cur_to - interval '1 second') at time zone cfg.tz)::date,$b$;
  c_old2 constant text := $a$    cross join lateral generate_series(cfg.cur_from::date,
                                       (cfg.cur_to - interval '1 second')::date,$a$;
  c_new3 constant text := $b$                      and (p.occurred_at at time zone cfg.tz)::date = d.day::date$b$;
  c_old3 constant text := $a$                      and (p.occurred_at at time zone 'UTC')::date = d.day::date$a$;
begin
  if (length(v_def) - length(replace(v_def, c_new1, ''))) / length(c_new1) <> 1
     or (length(v_def) - length(replace(v_def, c_new2, ''))) / length(c_new2) <> 1
     or (length(v_def) - length(replace(v_def, c_new3, ''))) / length(c_new3) <> 1 then
    raise exception 'dashboard_summary is not the text this rollback expects';
  end if;
  execute replace(replace(replace(v_def, c_new1, c_old1), c_new2, c_old2), c_new3, c_old3);
end;
$rollback$;
