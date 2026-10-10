"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/ui/native-select";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { FieldReportCard } from "@/components/reports/field-report-card";
import { CoverageTable } from "@/components/reports/coverage-table";
import { RepScorecardTable } from "@/components/reports/rep-scorecard-table";
import { ComplianceTrendChart } from "@/components/reports/compliance-trend-chart";
import { PhotoGrid } from "@/components/reports/photo-grid";
import { InsightsPanel } from "@/components/reports/insights-panel";
import { PerfectStoreTable } from "@/components/reports/perfect-store-table";
import { OosHotspotsTable } from "@/components/reports/oos-hotspots-table";
import { AdherenceTable } from "@/components/reports/adherence-table";
import { ServiceLogTable, type ReportAction, type ReportState } from "@/components/reports/service-log-table";
import { HoursTable } from "@/components/reports/hours-table";
import { StaffScoreTable } from "@/components/reports/staff-score-table";
import {
  fetchStaffScoreInputs,
  findPart,
  parseWeights,
  teamScorable,
  teamScores,
  type StaffScoreInputs,
} from "@/lib/staff-score";
import { StorePicker } from "@/components/stores/store-picker";
import { companyReportTabs, type ReportTab } from "@/lib/report-tabs";
import { companyReports, openReport, viewFilters, type ReportId, type ViewId } from "@/lib/report-catalogue";
import {
  daysBetween,
  hoursText,
  jobsPerDay,
  missedRows,
  pct,
  salesSummary,
  serviceSummary,
  teamBreakdown,
} from "@/lib/report-summary";
import {
  CompletedTable,
  DailyBars,
  MissedTable,
  SummaryTiles,
  TeamBreakdownTable,
  type Tile,
} from "@/components/reports/report-views";
import { moduleEnabled } from "@/lib/modules";
import { downloadServiceLogPdf, fetchServiceLog, serviceLogSheet, type ServiceLogRow } from "@/lib/service-log";
import { fetchStaffHours, hoursDay, hoursSheet, overtimeOn, overtimeSplit, weekStart, type StaffHoursRow } from "@/lib/staff-hours";
import { getCompanyConfig, useCompanyConfig, useTerms, type CompanyConfig } from "@/lib/use-company-config";
import { companyMidnight, companyRange, companyTime } from "@/lib/company-time";
import type { ModuleSet } from "@/lib/modules";
import { lower } from "@/lib/terms";
import { fileSlug } from "@/lib/export-filename";
import { ExportMenu } from "@/components/export-menu";
import type { ExportSheet } from "@/lib/export";
import { createClient } from "@/lib/supabase/client";
import {
  rangeForPreset,
  rangeDays,
  toLocalDateInput,
  toLocalDate,
  fromLocalDateInput,
  type DateRange,
} from "@/lib/date-range";
import {
  buildFormResponsesSheet,
  fetchComplianceTrends,
  fetchCoverageGaps,
  fetchFormReport,
  fetchFormResponseRows,
  fetchFormTemplates,
  fetchRepScorecard,
  fetchPerfectStoreScore,
  fetchOosHotspots,
  fetchScheduleAdherence,
  formatRate,
  summariseFieldStats,
  type Adherence,
  type CoverageGap,
  type FieldReport,
  type FormTemplate,
  type OosHotspot,
  type PerfectStore,
  type PhotoStats,
  type RepScore,
  type TrendPointRow,
} from "@/lib/reports";

/**
 * The day before an exclusive end, as a calendar operation.
 *
 * `new Date(+to - 86_400_000)` is a day of milliseconds, and a day is not
 * always 86,400,000 of them — across a daylight-saving boundary it lands on the
 * wrong date. Botswana keeps no daylight saving, so this cannot bite here and
 * is written properly anyway: the next tenant is the one it would bite.
 */
function dayBefore(exclusiveEnd: Date): Date {
  const d = new Date(exclusiveEnd);
  d.setDate(d.getDate() - 1);
  return d;
}

type Rep = { id: string; full_name: string | null };
type Store = { id: string; name: string; city: string | null };
/** A retail chain — Choppies, Sefelana, Liquarama. `store_groups` in the schema. */
type StoreGroup = { id: string; name: string };

/**
 * The tabs the chain filter actually narrows.
 *
 * Score, out-of-stock and coverage are one row per store, so they are filtered
 * exactly. The trend is recomputed in Postgres for the chain. The rep scorecard
 * and schedule adherence are one row per *rep* — a rep works several chains, so
 * narrowing them means recomputing their visits against the chain rather than
 * dropping rows, and neither RPC does that yet. Listing them here rather than
 * scattering `tab !== "reps"` checks keeps the honest answer in one place.
 */
const CHAIN_AWARE_TABS: readonly ViewId[] = ["score", "oos", "coverage", "trends", "summary"];

export default function ReportsPage() {
  const supabase = createClient();
  const terms = useTerms();
  const config = useCompanyConfig();
  /**
   * The modules the last load worked from. The hook keeps `null` for good if
   * its lookup fails, so the loader asks for the config itself (and shows the
   * failure with a Retry); this is what the tabs then follow.
   */
  const [loadedModules, setLoadedModules] = useState<ModuleSet | null>(null);
  const [loadedTabs, setLoadedTabs] = useState<string | null>(null);
  /** The whole configuration the last load worked from, for the same reason. */
  const [loadedConfig, setLoadedConfig] = useState<CompanyConfig | null>(null);
  const companyConfig = config ?? loadedConfig;
  /** The company's tabs in its order (`report_tabs`, seeded from its trade),
   * only those whose module it has (`REPORT_TAB_MODULE`): a cleaning company
   * has no Perfect Store, and asking for it would be refused. */
  const available = useMemo(
    () => companyReportTabs(config?.modules ?? loadedModules, config?.settings.report_tabs ?? loadedTabs),
    [config, loadedModules, loadedTabs]
  );
  const modulesNow = config?.modules ?? loadedModules;
  /**
   * The company's reports and the views in each (`lib/report-catalogue.ts`):
   * the old tabs it has, regrouped into Performance, Service, Team,
   * Compliance and Evidence (or a distributor's six).
   */
  const reports = useMemo(
    () => companyReports(modulesNow, config?.settings.report_tabs ?? loadedTabs, terms),
    [modulesNow, config, loadedTabs, terms]
  );

  /**
   * The range and the tab both come from the URL when it names them, because
   * the dashboard tiles link straight in: "out of stock rate, 6.2%" is a
   * question, and the answer is the hotspots table over the same days the tile
   * was measuring.
   *
   * Read **after mount**, not in the `useState` initialiser. This page is
   * prerendered, and an initialiser that reads `window.location` produces one
   * value on the server and another in the browser — a hydration mismatch on
   * the state that decides which RPCs run. `useSearchParams` would avoid the
   * window read and force the whole page into a Suspense boundary in this
   * version of Next, which is the same trade the global search declined.
   */
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  /** The report and view asked for: by a click, or by the link that opened the page. */
  const [chosen, setChosen] = useState<{ tab: string | null; view: string | null }>({ tab: null, view: null });
  /** What is open: the chosen report and view when the company has them, else its first. */
  const opened = useMemo(() => openReport(reports, chosen.tab, chosen.view), [reports, chosen]);
  const tab: ViewId = opened?.view.id ?? "summary";
  const filters = viewFilters(tab, modulesNow);
  /**
   * Whether the URL has been read yet.
   *
   * `load` must not fire before it has. Both effects run in the same flush, so
   * the default 30-day request and the URL's request would be in the air
   * together — and whichever *returned* last would win, which is not
   * necessarily the one the link asked for. A dashboard tile could then land on
   * its own range and quietly show, and export, the default.
   */
  const [urlRead, setUrlRead] = useState(false);
  /**
   * Which load this is.
   *
   * Seven RPCs go out together and a slow one from an earlier range can return
   * after a newer range's — and whichever *returns* last would otherwise win.
   * On a page whose tables are exported under a heading naming the range, that
   * is a file that says one period and contains another. The same guard the
   * dashboard and the global search already carry.
   */
  const loadSeq = useRef(0);

  //
  // `set-state-in-effect` is suppressed rather than satisfied, and it is worth
  // saying why: the two ways to avoid it are both worse here. Reading the URL
  // in the `useState` initialiser is the hydration mismatch this moved away
  // from, and adjusting state during render restarts the first render — which
  // is the hydration render — for the same reason. A mount-only effect that
  // runs once and hands the state to the pickers is the pattern React's own
  // documentation gives for reading a browser-only value.
  //
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only: the pickers own both from here, and re-reading the URL after
    // the user has changed one would put it back.
    setUrlRead(true);
    const q = new URLSearchParams(window.location.search);
    // A report (`?tab=compliance&view=…`) or an old tab name (`?tab=adherence`),
    // which opens the view it became: every dashboard link keeps working.
    setChosen({ tab: q.get("tab"), view: q.get("view") });

    const from = q.get("from");
    const to = q.get("to");
    if (!from || !to) return;
    const parsed = { from: fromLocalDateInput(from), to: fromLocalDateInput(to) };
    // A malformed date would otherwise produce an Invalid Date, which every RPC
    // below turns into a 400 the page reports as its own failure.
    if (Number.isNaN(+parsed.from) || Number.isNaN(+parsed.to)) return;
    setRange(parsed);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [repId, setRepId] = useState<string>("");
  const [storeId, setStoreId] = useState<string>("");
  /** The chain. Empty means the whole estate. */
  const [storeGroupId, setStoreGroupId] = useState<string>("");
  const [storeGroups, setStoreGroups] = useState<StoreGroup[]>([]);

  const [form, setForm] = useState<FieldReport[]>([]);
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  const [scores, setScores] = useState<RepScore[]>([]);
  const [trends, setTrends] = useState<TrendPointRow[]>([]);
  const [perfect, setPerfect] = useState<PerfectStore[]>([]);
  const [hotspots, setHotspots] = useState<OosHotspot[]>([]);
  const [adherence, setAdherence] = useState<Adherence[]>([]);
  const [serviceLog, setServiceLog] = useState<ServiceLogRow[]>([]);
  const [hoursRows, setHoursRows] = useState<StaffHoursRow[]>([]);
  /** The period's first day; the hours before it only fill in its first week's overtime. */
  const [hoursFirstDay, setHoursFirstDay] = useState("");
  const [teamInputs, setTeamInputs] = useState<StaffScoreInputs[]>([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  /** Each finished job's report: signed, sent (Stage 8.3). By visit id. */
  const [reportStates, setReportStates] = useState<Record<string, ReportState>>({});
  const [reportNote, setReportNote] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter options load once — they don't depend on the date range.
  useEffect(() => {
    (async () => {
      try {
        const [tpl, repRows, storeRows, groupRows] = await Promise.all([
          fetchFormTemplates(supabase),
          supabase
            .from("profiles")
            .select("id, full_name")
            .eq("role", "rep")
            .order("full_name", { ascending: true }),
          supabase
            .from("stores")
            .select("id, name, city")
            .eq("active", true)
            .order("name", { ascending: true }),
          supabase
            .from("store_groups")
            .select("id, name")
            .order("name", { ascending: true }),
        ]);
        setTemplates(tpl);
        setTemplateId((prev) => prev ?? tpl[0]?.id ?? null);
        setReps((repRows.data ?? []) as Rep[]);
        setStores((storeRows.data ?? []) as Store[]);
        setStoreGroups((groupRows.data ?? []) as StoreGroup[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    const runId = ++loadSeq.current;
    const isStale = () => runId !== loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      // Weekly buckets past ~6 weeks, or the x-axis becomes unreadable.
      const bucket = rangeDays(range) > 45 ? "week" : "day";
      // Only the reports this company has; the others are refused by the
      // database (`require_module`) and would fail the whole page. The config
      // is cached, so this is a request only when nothing has loaded it yet;
      // if it fails, the page says so and Retry asks again.
      const cfg = await getCompanyConfig();
      if (!cfg) throw new Error("Your company's settings could not be read.");
      if (isStale()) return;
      setLoadedModules(cfg.modules);
      setLoadedTabs(cfg.settings.report_tabs);
      setLoadedConfig(cfg);
      // The new reports group by the company's days, so they are asked for
      // the company's midnights, not the viewer's.
      const companyDays = companyRange(range, cfg.timezone);
      // A week's overtime needs the whole week, so hours start on the Monday
      // the period's first week began.
      const firstDay = toLocalDateInput(range.from);
      const hoursRange = { from: companyMidnight(weekStart(firstDay), cfg.timezone), to: companyDays.to };
      const mine = companyReportTabs(cfg.modules, cfg.settings.report_tabs);
      const has = (t: ReportTab) => mine.includes(t);
      const none = <T,>() => Promise.resolve([] as T[]);
      // The {Staff} tab scores everyone on the company's weights when every
      // part can be measured for the whole team at once; otherwise (sales and
      // retail audits, which only the employee report measures) it keeps the
      // scorecard it has always had.
      const teamMode = teamScorable(parseWeights(cfg.settings.staff_score_weights));
      const [g, s, t, f, ps, oh, ad, sl, hr, ti] = await Promise.all([
        has("coverage") ? fetchCoverageGaps(supabase, range) : none<CoverageGap>(),
        has("reps") && !teamMode ? fetchRepScorecard(supabase, range) : none<RepScore>(),
        has("trends")
          ? fetchComplianceTrends(supabase, range, bucket, storeGroupId || null)
          : none<TrendPointRow>(),
        templateId && (has("form") || has("photos"))
          ? fetchFormReport(supabase, templateId, range, {
              repIds: repId ? [repId] : undefined,
              storeIds: storeId ? [storeId] : undefined,
            })
          : none<FieldReport>(),
        has("score") ? fetchPerfectStoreScore(supabase, range) : none<PerfectStore>(),
        has("oos") ? fetchOosHotspots(supabase, range) : none<OosHotspot>(),
        has("adherence") ? fetchScheduleAdherence(supabase, range) : none<Adherence>(),
        has("service_log") ? fetchServiceLog(supabase, companyDays, storeId || null) : none<ServiceLogRow>(),
        has("hours") ? fetchStaffHours(supabase, hoursRange) : none<StaffHoursRow>(),
        has("reps") && teamMode ? fetchStaffScoreInputs(supabase, companyDays) : none<StaffScoreInputs>(),
      ]);
      if (isStale()) return;
      setGaps(g);
      setScores(s);
      setTrends(t);
      setForm(f);
      setPerfect(ps);
      setHotspots(oh);
      setAdherence(ad);
      setServiceLog(sl);
      void loadReportStates(sl.map((r) => r.visit_id));
      setHoursRows(hr);
      setHoursFirstDay(firstDay);
      setTeamInputs(ti);
    } catch (e) {
      if (isStale()) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Only the newest run owns the spinner; an older one finishing must not
      // clear it while the current one is still out — and `loading` is what the
      // export controls read to know the rows match the filters.
      if (!isStale()) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, templateId, repId, storeId, storeGroupId]);

  useEffect(() => {
    if (!urlRead) return;
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `load` still starts before this returns.
    void (async () => {
      await load();
    })();
  }, [load, urlRead]);

  /**
   * The chain filter, applied to the reports that are one row per store.
   *
   * Filtered here rather than in the RPC, and that is exact rather than a
   * shortcut: Perfect Store, Coverage and Out of stock all return a row per
   * store, so selecting the rows of a chain gives precisely that chain's rows.
   * There is no aggregate to get wrong. The one report where that is NOT true
   * is the trend, which sums across stores per bucket — it takes the chain as
   * an argument and is recomputed in Postgres.
   *
   * Matched on the group's name rather than its id because that is what these
   * RPCs return. A rename would break it, which is the cost; adding an id to
   * three function signatures is the price of avoiding it, and two of those
   * three have live bodies that disagree with the migrations in this repo.
   *
   * ⚠️ The rep scorecard and schedule adherence are NOT filtered. They are one
   * row per rep, and a rep works several chains — narrowing them correctly
   * means recomputing their visit counts against a chain in Postgres, not
   * dropping rows here. The UI says so rather than quietly showing estate-wide
   * figures under a chain heading.
   */
  const chainName = storeGroups.find((g) => g.id === storeGroupId)?.name ?? null;
  const byChain = useCallback(
    <T extends { store_group: string | null }>(rows: T[]): T[] =>
      chainName === null ? rows : rows.filter((r) => r.store_group === chainName),
    [chainName]
  );
  const perfectShown = useMemo(() => byChain(perfect), [byChain, perfect]);
  const gapsShown = useMemo(() => byChain(gaps), [byChain, gaps]);
  const hotspotsShown = useMemo(() => byChain(hotspots), [byChain, hotspots]);

  const photoGroups = useMemo(
    () =>
      form
        .filter((f) => f.field_type === "photo")
        .map((f) => ({
          label: f.label,
          paths: ((f.stats as PhotoStats | null)?.paths ?? []) as string[],
        })),
    [form]
  );

  const chartFields = useMemo(
    () => form.filter((f) => f.field_type !== "photo"),
    [form]
  );

  /** Overtime rules from the trade; all 0 and off means no overtime is shown. */
  const overtimeLimits = useMemo(
    () => ({
      dayHours: companyConfig?.settings.report_day_normal_hours ?? 0,
      weekHours: companyConfig?.settings.report_week_normal_hours ?? 0,
      sundayOvertime: companyConfig?.settings.report_sunday_is_overtime ?? false,
    }),
    [companyConfig]
  );
  const showOvertime = overtimeOn(overtimeLimits);
  /** Hours with the trade's short and long day marks and its overtime, the period's days only. */
  const hoursDays = useMemo(() => {
    const limits = {
      shortHours: companyConfig?.settings.report_short_day_hours ?? 0,
      longHours: companyConfig?.settings.report_long_day_hours ?? 0,
    };
    return overtimeSplit(
      hoursRows.map((r) => hoursDay(r, limits)),
      overtimeLimits
    ).filter((d) => d.day >= hoursFirstDay);
  }, [hoursRows, hoursFirstDay, companyConfig, overtimeLimits]);
  const timeZone = companyConfig?.timezone;

  const pickedStore = stores.find((st) => st.id === storeId) ?? null;

  async function loadReportStates(visitIds: string[]) {
    const next: Record<string, ReportState> = {};
    for (let i = 0; i < visitIds.length; i += 200) {
      const { data } = await supabase
        .from("job_reports")
        .select("visit_id, signed_name, signed_at, last_queued_at")
        .in("visit_id", visitIds.slice(i, i + 200));
      for (const r of data ?? []) next[r.visit_id] = r;
    }
    setReportStates(next);
  }

  async function reportLink(visitId: string): Promise<string> {
    const res = await fetch(`/api/job-reports/${visitId}/link`);
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "The report link could not be made.");
    return body.url;
  }

  async function onReport(visitId: string, action: ReportAction) {
    setReportNote(null);
    try {
      if (action === "open") {
        // Opened at once (a pop-up blocker allows only that), then pointed at the link.
        const win = window.open("", "_blank");
        let url: string;
        try {
          url = await reportLink(visitId);
        } catch (e) {
          win?.close();
          throw e;
        }
        if (win) win.location.href = url;
        else window.location.href = url;
      } else if (action === "copy") {
        await navigator.clipboard.writeText(await reportLink(visitId));
        setReportNote("Link copied. Anyone with it can see this report and sign it.");
      } else {
        const { data, error: e } = await supabase.rpc("send_job_report", { p_visit_id: visitId });
        if (e) throw new Error(e.message);
        setReportNote(
          data === 0
            ? `Nobody at this ${lower(terms.site.one)} gets reports yet. Add a contact with an email under ${terms.site.many}, Contacts.`
            : `Sent to ${data} ${data === 1 ? "contact" : "contacts"}. It arrives within five minutes.`
        );
      }
      await loadReportStates(serviceLog.map((r) => r.visit_id));
    } catch (e) {
      setReportNote(e instanceof Error ? e.message : String(e));
    }
  }

  // The same configuration the loader chose its mode from, even when the hook's lookup failed.
  const weights = useMemo(() => parseWeights(companyConfig?.settings.staff_score_weights), [companyConfig]);
  const teamMode = teamScorable(weights);
  const scored = useMemo(() => (teamMode ? teamScores(teamInputs, weights, terms) : []), [teamMode, teamInputs, weights, terms]);

  /** What the company has, so a figure from a report it lacks is left out rather than shown as nought. */
  const has = (t: ReportTab) => available.includes(t);
  const sells = modulesNow !== null && moduleEnabled(modulesNow, "distribution");
  const fromDay = toLocalDateInput(range.from);
  const toDay = toLocalDateInput(dayBefore(range.to));
  /** A person's full performance report, for the same period. */
  const staffReportHref = useCallback(
    (staffId: string) =>
      `/reports/rep-performance?${new URLSearchParams({ rep: staffId, from: fromDay, to: toLocalDateInput(range.to) }).toString()}`,
    [fromDay, range.to]
  );
  const service = useMemo(
    () =>
      serviceSummary({
        adherence: has("adherence") ? adherence : null,
        serviceLog: has("service_log") ? serviceLog : null,
        hours: has("hours") ? hoursDays : null,
        gaps: has("coverage") ? gaps : null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, adherence, serviceLog, hoursDays, gaps]
  );
  const sales = useMemo(
    () =>
      salesSummary({
        perfect: has("score") ? perfectShown : null,
        hotspots: has("oos") ? hotspotsShown : null,
        gaps: has("coverage") ? gapsShown : null,
        adherence: has("adherence") ? adherence : null,
        trends: has("trends") ? trends : null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, perfectShown, hotspotsShown, gapsShown, adherence, trends]
  );
  const team = useMemo(
    () => teamBreakdown(has("adherence") ? adherence : null, has("hours") ? hoursDays : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [available, adherence, hoursDays]
  );
  const missed = useMemo(() => missedRows(adherence), [adherence]);
  const daily = useMemo(() => jobsPerDay(serviceLog, daysBetween(fromDay, toDay)), [serviceLog, fromDay, toDay]);
  /** Links from a tile to the report that explains it. */
  const go = (report: ReportId, view?: ViewId) => () => chooseView(report, view ?? null);

  /** The headline figures for the open Performance summary, only those the company has data for. */
  function summaryTiles(): Tile[] {
    const job = lower(terms.job.many);
    const tiles: Tile[] = [];
    if (!sells) {
      if (service.completed !== null) tiles.push({ label: `${terms.job.many} done`, value: String(service.completed), onClick: go("service", "completed") });
      if (service.completionRate !== null)
        tiles.push({ label: "Done as planned", value: pct(service.completionRate), sub: `${service.planned} planned`, onClick: go("compliance") });
      if (service.missed !== null) tiles.push({ label: `Missed ${job}`, value: String(service.missed), onClick: go("service", "missed") });
      if (service.sitesServiced !== null) tiles.push({ label: `${terms.site.many} served`, value: String(service.sitesServiced) });
      if (service.coverage !== null)
        tiles.push({ label: `${terms.site.one} coverage`, value: pct(service.coverage), sub: `${terms.site.many} with a ${lower(terms.job.one)}`, onClick: go("performance", "coverage") });
      if (service.hours !== null) tiles.push({ label: "Hours worked", value: hoursText(service.hours), onClick: go("team", "hours") });
    } else {
      if (sales.perfectStore !== null) tiles.push({ label: `Perfect ${terms.site.one}`, value: String(sales.perfectStore), sub: "Average score", onClick: go("perfect_store") });
      if (sales.oosRate !== null) tiles.push({ label: "Out of stock", value: pct(sales.oosRate), sub: "Of checks", onClick: go("availability") });
      if (sales.coverage !== null) tiles.push({ label: "Coverage", value: pct(sales.coverage), sub: `${terms.site.many} visited`, onClick: go("coverage") });
      if (sales.adherence !== null)
        tiles.push({
          label: "Done as planned",
          value: pct(sales.adherence),
          sub: chainName ? `All ${lower(terms.site_group.many)}` : undefined,
          onClick: go("compliance"),
        });
      if (sales.audits !== null) tiles.push({ label: "Audits", value: String(sales.audits), onClick: go("perfect_store", "trends") });
    }
    return tiles;
  }

  /**
   * Open a report (and one of its views). Filters the new view does not use
   * are cleared: a {site} picked on Proof of service must not quietly narrow
   * the Performance summary.
   */
  function chooseView(report: ReportId, view: ViewId | null) {
    const next = openReport(reports, report, view);
    if (!next) return;
    const keep = viewFilters(next.view.id, modulesNow);
    if (!keep.includes("chain")) setStoreGroupId("");
    if (!keep.includes("staff")) setRepId("");
    if (!keep.includes("site")) setStoreId("");
    setChosen({ tab: next.report.id, view: next.view.id });
    // In the address, so a reload, a shared link or Back opens the same place.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next.report.id);
    url.searchParams.set("view", next.view.id);
    window.history.replaceState(null, "", url);
  }

  async function serviceLogPdf() {
    if (!storeId || serviceLog.length === 0) return;
    setPdfBusy(true);
    try {
      await downloadServiceLogPdf(
        supabase,
        serviceLog.filter((r) => r.store_id === storeId),
        { from: toLocalDateInput(range.from), to: toLocalDateInput(dayBefore(range.to)) },
        terms,
        timeZone ?? "UTC"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  }


  /**
   * The open tab, as a spreadsheet.
   *
   * One tab, not all eight. The old export wrote coverage, the scorecard and
   * the trend into a single CSV whatever you were looking at, so the file never
   * matched the screen and three of its sections were noise. Exporting what is
   * in front of you is the version somebody can hand to a supplier.
   *
   * Photos are the one tab with nothing to export — a grid of images is not a
   * table, and a spreadsheet of storage paths would be a worse answer than
   * saying so.
   */
  /**
   * The filter lines that go above every table this page exports.
   *
   * Shared by both Form-tab exports rather than rebuilt: the per-response file
   * and the question summary come from the same filters, and two copies of
   * these lines is how one of them ends up stating a filter that no longer
   * exists.
   */
  function exportContext(): string[] {
    // The chain reaches four of the six exportable tabs. It is written into the
    // context lines only for those — a "Chain: Choppies Group" heading over the
    // rep scorecard would be exactly the lie the note below warns about.
    const chainLine =
      chainName && CHAIN_AWARE_TABS.includes(tab)
        ? `${terms.site_group.one}: ${chainName}`
        : null;
    // 🔴 The rep, store and form pickers filter **only** the Form report —
    // every other query on this page takes the date range and nothing else. A
    // Coverage export headed "Rep: Jerry Habana" would therefore have been a
    // lie about rows covering the whole estate, which is worse than a file with
    // no context at all: this one reads as evidence.
    const formFilters =
      tab === "service_log" || tab === "completed"
        ? [storeId ? `${terms.site.one}: ${pickedStore?.name ?? storeId}` : null]
        : tab === "form"
        ? [
            repId
              ? `${terms.staff.one}: ${reps.find((r) => r.id === repId)?.full_name ?? repId}`
              : null,
            storeId
              ? `${terms.site.one}: ${stores.find((st) => st.id === storeId)?.name ?? storeId}`
              : null,
            templateId
              ? `Form: ${templates.find((t) => t.id === templateId)?.name ?? templateId}`
              : null,
          ]
        : [];
    return [
      `${toLocalDateInput(range.from)} to ${toLocalDateInput(dayBefore(range.to))}`,
      chainLine,
      ...formFilters,
    ].filter((line): line is string => line !== null);
  }

  /**
   * Every submission of the selected form, one row each.
   *
   * The other export on this page — and until now the *only* one — is
   * `sheetForTab`'s Form case: a row per question, with five of its answers
   * previewed in a cell. That is a picture of the charts, and the charts are
   * already on screen. This is the file somebody actually asked for: 100
   * submissions in 100 rows, with the store, the rep and the date beside each
   * one, so it sorts and pivots like data.
   *
   * Fetched here rather than in `load`, because nothing on the page needs it —
   * a manager who never opens this menu should never pay for the rows. The
   * shaping is `buildFormResponsesSheet`, next to the fetcher and away from the
   * component, so the file's own structure can be checked without a session.
   */
  async function formResponsesSheet(): Promise<ExportSheet | null> {
    if (!templateId) return null;
    const { rows, truncated } = await fetchFormResponseRows(
      supabase,
      templateId,
      range,
      {
        repIds: repId ? [repId] : undefined,
        storeIds: storeId ? [storeId] : undefined,
      }
    );
    return buildFormResponsesSheet(form, rows, {
      context: exportContext(),
      truncated,
      terms,
    });
  }

  function sheetForTab(): ExportSheet | null {
    const base = { context: exportContext() };
    const site = terms.site.one;
    const group = terms.site_group.one;
    const staff = terms.staff.one;

    switch (tab) {
      case "score":
        return {
          ...base,
          title: `Perfect ${site} score`,
          filename: `perfect-${fileSlug(site)}`,
          columns: [
            { header: site, key: "store" },
            { header: "Group", key: "group" },
            { header: "Audits", key: "audits", numeric: true },
            { header: "Availability %", key: "availability", numeric: true },
            { header: "Planogram %", key: "planogram", numeric: true },
            { header: "Price %", key: "price", numeric: true },
            { header: "Condition %", key: "condition", numeric: true },
            { header: "Score", key: "score", numeric: true },
          ],
          rows: perfectShown.map((r) => ({
            store: r.store_name,
            group: r.store_group ?? "",
            audits: r.audits,
            availability: r.availability_pct,
            planogram: r.planogram_pct,
            price: r.price_pct,
            condition: r.condition_pct,
            score: r.score,
          })),
        };
      case "oos":
        return {
          ...base,
          title: "Out-of-stock hotspots",
          filename: "out-of-stock",
          columns: [
            { header: site, key: "store" },
            { header: group, key: "group" },
            { header: "Checks", key: "checks", numeric: true },
            { header: "Out of stock", key: "oos", numeric: true },
            { header: "Rate", key: "rate" },
            { header: "Longest run", key: "run", numeric: true },
            { header: "Last seen out", key: "last" },
            { header: "Top lines", key: "skus" },
          ],
          rows: hotspotsShown.map((r) => ({
            store: r.store_name,
            group: r.store_group ?? "—",
            checks: r.checks,
            oos: r.oos_count,
            rate: formatRate(r.oos_rate),
            run: r.max_consecutive_oos,
            last: toLocalDate(r.last_oos_at),
            skus: r.top_skus.map((t) => `${t.sku} (${t.n})`).join(", "),
          })),
        };
      case "coverage":
        return {
          ...base,
          title: `${site} coverage`,
          filename: "coverage",
          columns: [
            { header: site, key: "store" },
            { header: "Group", key: "group" },
            { header: "Town", key: "city" },
            { header: `Responsible ${lower(staff)}`, key: "reps" },
            { header: `${terms.job.many} in period`, key: "visits", numeric: true },
            { header: "Last visited", key: "last" },
            { header: `Days since last ${lower(terms.job.one)}`, key: "days" },
          ],
          rows: gapsShown.map((g) => ({
            store: g.store_name,
            group: g.store_group ?? "",
            city: g.city ?? "",
            reps: g.assigned_reps ?? "",
            visits: g.visits_in_period,
            last: toLocalDate(g.last_visit_at) || "never",
            // "never visited" rather than a blank: an empty cell in this column
            // reads as nought days, which is the opposite of what it means.
            days: g.days_since ?? "never visited",
          })),
        };
      case "adherence":
        return {
          ...base,
          title: "Schedule adherence",
          filename: "adherence",
          columns: [
            { header: staff, key: "rep" },
            { header: "Planned", key: "planned", numeric: true },
            { header: "Completed", key: "completed", numeric: true },
            { header: "Missed", key: "missed", numeric: true },
            { header: "Adherence", key: "rate" },
            { header: "Missed stops", key: "detail" },
          ],
          rows: adherence.map((a) => ({
            rep: a.rep_name ?? "",
            planned: a.planned,
            completed: a.completed,
            missed: a.missed,
            rate: formatRate(a.adherence_rate),
            detail: a.missed_detail
              .map((m) => `${m.store} (${m.date.slice(0, 10)})`)
              .join(", "),
          })),
        };
      case "reps":
        if (teamMode) {
          return {
            ...base,
            title: `${staff} scores`,
            filename: `${fileSlug(staff)}-scores`,
            columns: [
              { header: staff, key: "name" },
              { header: "Score", key: "score", numeric: true },
              { header: "Band", key: "band" },
              ...weights.map((w) => ({ header: `${findPart(w.code)!.label(terms)} (${w.weight}%)`, key: w.code })),
              { header: "Work on this next", key: "focus" },
            ],
            rows: scored.map((r) => ({
              name: r.name,
              score: r.result.score ?? "",
              band: r.result.band,
              ...Object.fromEntries(
                r.result.components.map((c) => [
                  c.key,
                  c.state === "scored" ? Math.round(c.value ?? 0) : c.state === "not_enough" ? "Not enough data" : "Not measured yet",
                ])
              ),
              focus: r.result.focus?.label ?? "",
            })),
          };
        }
        return {
          ...base,
          title: `${staff} scorecard`,
          filename: `${fileSlug(staff)}-scorecard`,
          columns: [
            { header: staff, key: "rep" },
            { header: "Completed", key: "completed", numeric: true },
            { header: "Total", key: "total", numeric: true },
            { header: "Done as planned", key: "completion" },
            { header: `${terms.site.many} covered`, key: "stores", numeric: true },
            { header: "Forms", key: "forms" },
            { header: "Location verified", key: "verified" },
          ],
          rows: scores.map((r) => ({
            rep: r.rep_name ?? "",
            completed: r.visits_completed,
            total: r.visits_total,
            completion: formatRate(r.completion_rate),
            stores: r.stores_covered,
            forms: formatRate(r.form_compliance_rate),
            verified: formatRate(r.verified_rate),
          })),
        };
      case "trends":
        return {
          ...base,
          title: "Compliance trend",
          filename: "compliance-trend",
          columns: [
            { header: "Bucket", key: "bucket" },
            { header: "Submissions", key: "submissions", numeric: true },
            { header: "Out of stock", key: "oos" },
            { header: "Planogram OK", key: "planogram" },
            { header: "Price correct", key: "price" },
            { header: "Avg facings", key: "facings", numeric: true },
          ],
          rows: trends.map((t) => ({
            bucket: t.bucket_start.slice(0, 10),
            submissions: t.submissions,
            oos: formatRate(t.oos_rate),
            planogram: formatRate(t.planogram_rate),
            price: formatRate(t.price_correct_rate),
            facings: t.avg_facings,
          })),
        };
      case "form":
        return {
          ...base,
          title: "Form results",
          filename: "form-results",
          columns: [
            { header: "Question", key: "label" },
            { header: "Type", key: "type" },
            { header: "Answers", key: "answers", numeric: true },
            { header: "Summary", key: "summary" },
          ],
          rows: chartFields.map((f) => ({
            label: f.label,
            type: f.field_type,
            answers: f.response_count,
            summary: summariseFieldStats(f),
          })),
        };
      case "summary":
        // The figures on screen, then the team behind them.
        return {
          ...base,
          title: "Performance summary",
          filename: "performance",
          columns: [
            { header: "Measure", key: "measure" },
            { header: "Value", key: "value" },
            { header: "Note", key: "note" },
          ],
          rows: summaryTiles().map((tile) => ({ measure: tile.label, value: tile.value, note: tile.sub ?? "" })),
        };
      case "completed":
        return {
          ...base,
          title: `Completed ${lower(terms.job.many)}`,
          filename: `completed-${fileSlug(terms.job.many)}`,
          columns: [
            { header: "Date", key: "date" },
            { header: terms.site.one, key: "site" },
            { header: staff, key: "staff" },
            { header: "Start", key: "start" },
            { header: "End", key: "end" },
            { header: "Minutes", key: "minutes", numeric: true },
            { header: "Planned", key: "planned" },
          ],
          rows: [...serviceLog]
            .sort((x, y) => y.checkin_at.localeCompare(x.checkin_at))
            .map((r) => ({
              date: r.day,
              site: r.store_name,
              staff: r.staff_name ?? "",
              start: companyTime(r.checkin_at, timeZone),
              end: companyTime(r.checkout_at, timeZone),
              minutes: r.minutes,
              planned: r.planned ? "Planned" : "Not planned",
            })),
        };
      case "missed":
        return {
          ...base,
          title: `Missed ${lower(terms.job.many)}`,
          filename: `missed-${fileSlug(terms.job.many)}`,
          columns: [
            { header: "Date", key: "date" },
            { header: terms.site.one, key: "site" },
            { header: staff, key: "staff" },
          ],
          rows: missed.map((m) => ({ date: m.date, site: m.site, staff: m.staff })),
        };
      case "service_log":
        return serviceLogSheet(serviceLog, terms, base.context, timeZone ?? "UTC");
      case "hours":
        return hoursSheet(hoursDays, terms, base.context, timeZone ?? "UTC", showOvertime);
      default:
        return null;
    }
  }

  const viewLabel = opened?.view.label ?? "";
  const reportLabel = opened?.report.label ?? "Reports";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{reportLabel}</h1>
          <p className="text-sm text-pretty text-muted-foreground">{opened?.report.question ?? "Reports"}</p>
        </div>
        {/* Forms have two honest answers to "export this": the responses
            themselves, and the summary of them. Responses first. Photos are a
            gallery, not a table, and have nothing to export. */}
        {tab !== "photos" && (
          <ExportMenu
            variants={
              tab === "form"
                ? [
                    { label: "Every response", build: formResponsesSheet },
                    { label: "Question summary", build: sheetForTab },
                  ]
                : [{ build: sheetForTab }]
            }
            disabled={loading || !opened}
            label={`Export ${viewLabel === "Summary" ? reportLabel : viewLabel}`}
          />
        )}
      </div>

      {/* The reports: few, each answering one question. */}
      <Tabs
        value={opened?.report.id ?? ""}
        onValueChange={(v) => chooseView(v as ReportId, null)}
      >
        <TabsList className="max-w-full justify-start overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:px-3">
          {reports.map((r) => (
            <TabsTrigger key={r.id} value={r.id}>
              {r.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* The views of the open report, when it has more than one: underlined,
          so they read as parts of the report above rather than as filters. */}
      {opened && opened.report.views.length > 1 && (
        <div role="tablist" aria-label={`${reportLabel} views`} className="-mt-1 flex flex-wrap gap-x-5 border-b border-border">
          {opened.report.views.map((v) => {
            const on = v.id === tab;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => chooseView(opened.report.id, v.id)}
                className={`-mb-px inline-flex h-9 items-center border-b-2 text-sm transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${
                  on
                    ? "border-gold font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <DateRangePicker value={range} onChange={setRange} />
        {/* Only the filters this view uses: a filter it ignores is not offered. */}
        {filters.includes("chain") && storeGroups.length > 0 && (
          <NativeSelect
            aria-label={terms.site_group.one}
            className="w-[13rem]"
            value={storeGroupId}
            onChange={(e) => setStoreGroupId(e.target.value)}
          >
            <option value="">All {lower(terms.site_group.many)}</option>
            {storeGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {filters.includes("template") && (
          <NativeSelect
            aria-label="Form"
            className="w-[15rem]"
            value={templateId ?? ""}
            onChange={(e) => setTemplateId(e.target.value || null)}
          >
            {templates.length === 0 && <option value="">No forms</option>}
            {/* Archived forms are offered, and say so: this page reads what
                was submitted, and a form taken off the phones last week still
                has last month's answers. */}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.active ? t.name : `${t.name} (archived)`}
              </option>
            ))}
          </NativeSelect>
        )}
        {filters.includes("staff") && (
          <NativeSelect
            aria-label={terms.staff.one}
            className="w-[11rem]"
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
          >
            <option value="">All {lower(terms.staff.many)}</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name ?? "Unnamed"}
              </option>
            ))}
          </NativeSelect>
        )}
        {filters.includes("site") && (
          <StorePicker
            className="w-[13rem]"
            stores={stores}
            value={storeId}
            onChange={setStoreId}
            allLabel={`All ${lower(terms.site.many)}`}
            placeholder={`All ${lower(terms.site.many)}`}
          />
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load reports</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {!opened && !loading && !error && (
        <EmptyCard>Reports are not part of your plan yet.</EmptyCard>
      )}

      {/* ------------------------------------------------- Performance summary */}
      {tab === "summary" && opened && (
        <div className="space-y-4">
          {loading ? <SkeletonRows /> : <SummaryTiles tiles={summaryTiles()} />}
          {!sells && has("service_log") && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{terms.job.many} done each day</CardTitle>
              </CardHeader>
              <CardContent>{loading ? <SkeletonRows /> : <DailyBars data={daily} label={terms.job.many} />}</CardContent>
            </Card>
          )}
          {sells && has("trends") && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{terms.site.one} standards over time</CardTitle>
              </CardHeader>
              <CardContent>{loading ? <SkeletonRows /> : <ComplianceTrendChart rows={trends} />}</CardContent>
            </Card>
          )}
          {(has("adherence") || has("hours")) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">By {lower(terms.staff.one)}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Click a name for that {lower(terms.staff.one)}&apos;s full report for these dates.
                </p>
              </CardHeader>
              <CardContent className="px-0">
                {loading ? <SkeletonRows /> : <TeamBreakdownTable rows={team} reportHref={staffReportHref} />}
              </CardContent>
            </Card>
          )}
          <InsightsPanel
            request={{ reportType: "reports", range, templateId }}
            title="Manager briefing"
            blurb={`Summarise this period’s coverage, ${lower(terms.staff.one)} performance and compliance, and point out what is worth acting on.`}
          />
        </div>
      )}

      {/* ------------------------------------------------------ Service */}
      {tab === "completed" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Completed {lower(terms.job.many)}</CardTitle>
            <p className="text-xs text-pretty text-muted-foreground">
              Every {lower(terms.job.one)} finished in the period, newest first.{" "}
              {has("service_log") && "Its photos, forms and check-in location are on Evidence."}
            </p>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? <SkeletonRows /> : <CompletedTable rows={serviceLog} timeZone={timeZone} />}
          </CardContent>
        </Card>
      )}

      {tab === "missed" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Missed {lower(terms.job.many)}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Planned {lower(terms.job.many)} that were not done. Future dates are not counted.
            </p>
          </CardHeader>
          <CardContent className="px-0">{loading ? <SkeletonRows /> : <MissedTable rows={missed} />}</CardContent>
        </Card>
      )}

      {/* --------------------------------------------- Perfect Store, Availability */}
      {tab === "score" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Perfect {terms.site.one} score</CardTitle>
            <p className="text-xs text-muted-foreground">
              Availability, planogram, price accuracy and stock condition averaged into one index, worst{" "}
              {lower(terms.site.one)} first. Promotional displays are left out: they show whether a promotion was
              running, not whether the {lower(terms.site.one)} carried it out.
            </p>
          </CardHeader>
          <CardContent className="px-0">{loading ? <SkeletonRows /> : <PerfectStoreTable rows={perfectShown} />}</CardContent>
        </Card>
      )}

      {tab === "trends" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Standards over time</CardTitle>
            <p className="text-xs text-muted-foreground">Out of stock, planogram and price, by day, or by week over six weeks.</p>
          </CardHeader>
          <CardContent>{loading ? <SkeletonRows /> : <ComplianceTrendChart rows={trends} />}</CardContent>
        </Card>
      )}

      {tab === "oos" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Out of stock</CardTitle>
            <p className="text-xs text-muted-foreground">
              &ldquo;Worst run&rdquo; is the longest unbroken run of {lower(terms.job.many)} that found an empty shelf:
              the difference between a supply problem and an unlucky day.
            </p>
          </CardHeader>
          <CardContent className="px-0">{loading ? <SkeletonRows /> : <OosHotspotsTable rows={hotspotsShown} />}</CardContent>
        </Card>
      )}

      {/* ----------------------------------------------------- Coverage */}
      {tab === "coverage" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{terms.site.one} coverage</CardTitle>
            <p className="text-xs text-muted-foreground">
              Longest gap first. &ldquo;Last {lower(terms.job.one)}&rdquo; looks across all history, not just this
              period.
            </p>
          </CardHeader>
          <CardContent className="px-0">{loading ? <SkeletonRows /> : <CoverageTable rows={gapsShown} />}</CardContent>
        </Card>
      )}

      {/* --------------------------------------------------------- Team */}
      {tab === "reps" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{terms.staff.one} scores</CardTitle>
            <p className="text-xs text-pretty text-muted-foreground">
              {teamMode
                ? `Each ${lower(terms.staff.one)}'s score, weighted for your trade. A month reads best: a part needs at least five events, and planned work on approved leave is left out. `
                : ""}
              Click a name for that {lower(terms.staff.one)}&apos;s full report.
            </p>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? (
              <SkeletonRows />
            ) : teamMode ? (
              <StaffScoreTable scores={scored} weights={weights} reportHref={staffReportHref} />
            ) : (
              <RepScorecardTable rows={scores} reportHref={staffReportHref} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "hours" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Hours</CardTitle>
            <p className="text-xs text-pretty text-muted-foreground">
              Each {lower(terms.staff.one)}&apos;s day from the workday they started on the phone. &ldquo;Between&rdquo;
              is the workday not spent on a {lower(terms.job.one)}: travel and waiting. Export it for payroll.
            </p>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? <SkeletonRows /> : <HoursTable days={hoursDays} timeZone={timeZone} overtime={showOvertime} />}
          </CardContent>
        </Card>
      )}

      {/* --------------------------------------------------- Compliance */}
      {tab === "adherence" && (
        <div className="space-y-4">
          {!loading && (
            <SummaryTiles
              tiles={[
                { label: "Planned", value: String(service.planned ?? 0) },
                { label: "Done as planned", value: pct(service.completionRate) },
                { label: `Missed ${lower(terms.job.many)}`, value: String(service.missed ?? 0), onClick: go("service", "missed") },
              ]}
            />
          )}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{terms.staff.one} adherence</CardTitle>
              <p className="text-xs text-pretty text-muted-foreground">
                Planned {lower(terms.job.many)} against those done. Future dates are not counted. Check-ins away from
                the {lower(terms.site.one)} are on{" "}
                <Link className="underline" href={`/visits/off-site?from=${fromDay}&to=${toLocalDateInput(range.to)}`}>
                  Off-site check-ins
                </Link>
                , and every check-in on{" "}
                <Link className="underline" href="/activities">
                  Activity
                </Link>
                .
              </p>
            </CardHeader>
            <CardContent className="px-0">{loading ? <SkeletonRows /> : <AdherenceTable rows={adherence} />}</CardContent>
          </Card>
        </div>
      )}

      {/* ----------------------------------------------------- Evidence */}
      {tab === "service_log" && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base">Proof of service</CardTitle>
              <p className="text-xs text-pretty text-muted-foreground">
                Every finished {lower(terms.job.one)}, by {lower(terms.site.one)}: who, when, whether they checked in on
                site, and the forms and photos that show it.{" "}
                {pickedStore
                  ? `Showing ${pickedStore.name} only.`
                  : `Pick one ${lower(terms.site.one)} above to make its PDF for your ${lower(terms.client.one)}.`}
              </p>
            </div>
            {pickedStore && (
              <Button variant="outline" size="sm" onClick={serviceLogPdf} disabled={loading || pdfBusy || serviceLog.length === 0}>
                {pdfBusy ? "Making PDF…" : `PDF for ${pickedStore.name}`}
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-0">
            {reportNote && (
              <p className="mx-4 mb-3 rounded-md bg-muted/60 px-3 py-2 text-sm text-foreground" aria-live="polite">
                {reportNote}
              </p>
            )}
            {loading ? (
              <SkeletonRows />
            ) : (
              <ServiceLogTable rows={serviceLog} timeZone={timeZone} reports={reportStates} onReport={onReport} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "photos" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Photos</CardTitle>
            <p className="text-xs text-muted-foreground">The photos taken on the form chosen above.</p>
          </CardHeader>
          <CardContent>{loading ? <SkeletonRows /> : <PhotoGrid groups={photoGroups} />}</CardContent>
        </Card>
      )}

      {tab === "form" &&
        (loading ? (
          <SkeletonGrid />
        ) : chartFields.length === 0 ? (
          <EmptyCard>No responses to this form in the selected period.</EmptyCard>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {chartFields.map((f) => (
              <FieldReportCard key={f.field_id} field={f} />
            ))}
          </div>
        ))}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="h-48 animate-pulse rounded-md bg-muted/50" />
        </Card>
      ))}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2 p-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
      ))}
    </div>
  );
}
