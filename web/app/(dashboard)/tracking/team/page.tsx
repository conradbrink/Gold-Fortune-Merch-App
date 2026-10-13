"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExportMenu } from "@/components/export-menu";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  DetailHeader,
  FigureStrip,
  FilterChip,
  InsightPanel,
  ListTools,
  SortHead,
  TilePicker,
  TopCard,
  type SortState,
  type Tile,
} from "@/components/dashboard/detail-page";
import { rangeFromQuery, rangeQuery, reportHref, trackingHref } from "@/lib/dashboard-links";
import {
  fetchDashboardSummary,
  fetchOffsiteCheckins,
  fetchRepDayTimes,
  formatPct,
  formatTimeOfDay,
  type DashboardSummary,
  type OffsiteCheckin,
  type RepDayTimes,
} from "@/lib/dashboard";
import { rangeForPreset, toLocalDateInput, type DateRange } from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { NOW_GROUPS, NOW_LABELS, nowGroups, type NowGroup } from "@/lib/field-team";
import { FRESH_INTERVALS, describeAge, describeSource, fetchLiveReps, freshnessOf, minutesSince, type LiveReps } from "@/lib/live-reps";
import { fetchRepScorecard, type RepScore } from "@/lib/reports";
import { createClient } from "@/lib/supabase/client";
import { lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

const DOT = {
  fresh: "bg-emerald-500",
  recent: "bg-amber-500",
  stale: "bg-muted-foreground/50",
  unknown: "bg-slate-300 dark:bg-slate-600",
} as const;

type SortKey = "name" | "visits" | "days" | "offsite";

/** One person on the page: where they are now, and their period. */
type Person = {
  id: string;
  name: string;
  now: NowGroup | null;
  /** "At Riverside Supermarket · 12 min ago", or why there is nothing. */
  where: string;
  freshness: keyof typeof DOT | null;
  visitsDone: number;
  visitsPlanned: number;
  storesVisited: number;
  daysWorked: number;
  avgStart: number | null;
  offsite: number;
};

/**
 * The Field team card, opened up: who is sending positions now, who has gone
 * quiet and who has sent nothing all day, then what each person did over the
 * period, side by side. Each person opens their own day on Tracking.
 *
 * "Now" is the card's own list (`fetchLiveReps`), so the tiles are the card's
 * dots counted. The period figures are the Reports team view's
 * (`rep_scorecard`), the dashboard's working-day times (`rep_day_times`) and
 * its off-site rule (`offsite_checkins`), over the dashboard's dates.
 */
export default function FieldTeamPage() {
  const t = useTerms();
  const router = useRouter();
  const config = useCompanyConfig();
  const interval = config?.settings.gps_ping_interval_minutes ?? null;

  const [range, setRange] = useState<DateRange>(() => rangeForPreset("30d"));
  const [urlRead, setUrlRead] = useState(false);
  const [live, setLive] = useState<LiveReps | null>(null);
  const [scores, setScores] = useState<RepScore[]>([]);
  const [days, setDays] = useState<RepDayTimes[]>([]);
  const [offsite, setOffsite] = useState<OffsiteCheckin[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  /** The period figures that could not be read: shown as unknown, never as nought. */
  const [failed, setFailed] = useState({ scores: false, days: false, offsite: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<NowGroup | null>(null);
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "visits", dir: "desc" });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only, as on the off-site list: the picker owns the range from here.
    const r = rangeFromQuery(new URLSearchParams(window.location.search));
    if (r) setRange(r);
    setUrlRead(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!urlRead) return;
    let stale = false;
    const supabase = createClient();
    Promise.allSettled([
      fetchLiveReps(supabase, t),
      fetchRepScorecard(supabase, range),
      fetchRepDayTimes(supabase, range),
      fetchOffsiteCheckins(supabase, range),
      fetchDashboardSummary(supabase, range),
    ]).then(([l, sc, dy, off, sum]) => {
      if (stale) return;
      // "Now" is the page; each period figure costs only its own column.
      if (l.status === "rejected") {
        setError(l.reason instanceof Error ? l.reason.message : String(l.reason));
        setLive(null);
      } else {
        setLive(l.value);
        setError(null);
      }
      setScores(sc.status === "fulfilled" ? sc.value : []);
      setDays(dy.status === "fulfilled" ? dy.value : []);
      setOffsite(off.status === "fulfilled" ? off.value : []);
      setSummary(sum.status === "fulfilled" ? sum.value : null);
      setFailed({ scores: sc.status === "rejected", days: dy.status === "rejected", offsite: off.status === "rejected" });
      setNow(Date.now());
      setLoading(false);
    });
    return () => {
      stale = true;
    };
    // The staff word only names somebody without a name; not worth a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRead, range, attempt]);

  function changeRange(next: DateRange) {
    setLoading(true);
    setRange(next);
    const url = new URL(window.location.href);
    const q = rangeQuery(next);
    url.searchParams.set("from", q.from);
    url.searchParams.set("to", q.to);
    window.history.replaceState(null, "", url);
  }

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }

  // Not until the company's GPS interval is known: without it every position
  // would read as quiet for a moment.
  const groupOf = useMemo(
    () => (live && config ? nowGroups(live, interval, now) : new Map<string, NowGroup>()),
    [live, config, interval, now]
  );

  /** Everybody on the team: the card's list, plus anybody with work in the period. */
  const people = useMemo(() => {
    const m = new Map<string, Person>();
    const blank = (id: string, name: string): Person => ({
      id,
      name,
      now: groupOf.get(id) ?? null,
      where: "",
      freshness: null,
      visitsDone: 0,
      visitsPlanned: 0,
      storesVisited: 0,
      daysWorked: 0,
      avgStart: null,
      offsite: 0,
    });
    for (const p of live?.positions ?? []) {
      const mins = minutesSince(p.recordedAt, now);
      m.set(p.repId, {
        ...blank(p.repId, p.repName),
        where: `${describeSource(p.source, p.storeName)}${p.dayOpen ? "" : ", day ended"} · ${describeAge(mins)}`,
        freshness: freshnessOf(mins, interval),
      });
    }
    for (const x of live?.missing ?? []) {
      m.set(x.repId, { ...blank(x.repId, x.repName), where: x.dayOpen ? `${t.workday.one} open, no position sent` : "No position in 24 hours" });
    }
    const unnamed = `Unnamed ${lower(t.staff.one)}`;
    for (const s of scores) {
      const cur = m.get(s.rep_id) ?? blank(s.rep_id, s.rep_name ?? unnamed);
      m.set(s.rep_id, {
        ...cur,
        visitsDone: Number(s.visits_completed ?? 0),
        visitsPlanned: Number(s.visits_total ?? 0),
        storesVisited: Number(s.stores_covered ?? 0),
      });
    }
    for (const d of days) {
      const cur = m.get(d.rep_id) ?? blank(d.rep_id, d.rep_name ?? unnamed);
      m.set(d.rep_id, { ...cur, daysWorked: Number(d.days_worked ?? 0), avgStart: d.avg_start_seconds == null ? null : Number(d.avg_start_seconds) });
    }
    for (const o of offsite) {
      const cur = m.get(o.rep_id) ?? blank(o.rep_id, o.rep_name ?? unnamed);
      m.set(o.rep_id, { ...cur, offsite: cur.offsite + 1 });
    }
    return [...m.values()];
  }, [live, scores, days, offsite, groupOf, interval, now, t.staff.one, t.workday.one]);

  const counts = useMemo(() => {
    const c = { live: 0, quiet: 0, silent: 0 } as Record<NowGroup, number>;
    for (const g of groupOf.values()) c[g] += 1;
    return c;
  }, [groupOf]);

  const inView = useMemo(() => (group ? people.filter((p) => p.now === group) : people), [people, group]);
  const activePerson = inView.some((p) => p.id === person) ? person : "";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = inView.filter((p) => (!activePerson || p.id === activePerson) && (!q || p.name.toLowerCase().includes(q)));
    const sign = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const by =
        sort.key === "name"
          ? a.name.localeCompare(b.name)
          : sort.key === "visits"
            ? a.visitsDone - b.visitsDone
            : sort.key === "days"
              ? a.daysWorked - b.daysWorked
              : a.offsite - b.offsite;
      return sign * by || a.name.localeCompare(b.name);
    });
  }, [inView, activePerson, search, sort]);

  function chooseSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  }

  const chooseGroup = (g: NowGroup | null) => {
    setGroup(g);
    setPerson("");
  };

  const tiles: Tile[] = NOW_GROUPS.map((g) => ({
    id: g,
    label: NOW_LABELS[g],
    value: counts[g],
    tone: counts[g] === 0 ? undefined : g === "live" ? "good" : g === "silent" ? "bad" : "warn",
  }));

  const lastDay = new Date(range.to);
  lastDay.setDate(lastDay.getDate() - 1);
  const rangeLabel = `${toLocalDateInput(range.from)} to ${toLocalDateInput(lastDay)}`;
  const staffWord = (n: number) => lower(n === 1 ? t.staff.one : t.staff.many);
  const meaning =
    group === null
      ? `${groupOf.size} ${staffWord(groupOf.size)} on the team. ${counts.live} sending positions now, ${counts.quiet} gone quiet, ${counts.silent} with nothing in 24 hours.`
      : group === "live"
        ? `Their phones sent a position in the last ${interval ? interval * FRESH_INTERVALS : "few"} minutes.`
        : group === "quiet"
          ? "They sent positions today, but not recently. A day that has ended shows as quiet too."
          : `Nothing from their phones in 24 hours. Call them, or check the phone is signed in to the app.`;

  const s = summary?.current;
  const figures = [
    { label: `${t.job.many} done`, value: s ? s.visits_completed : "-", href: "/visits" },
    {
      label: `${t.site.many} visited`,
      value: s ? `${s.stores_covered} of ${summary?.stores_active ?? 0}` : "-",
      href: reportHref("coverage", range),
    },
    { label: "Out of stock", value: formatPct(s?.oos_rate ?? null), href: reportHref("availability", range) },
    { label: "Planogram", value: formatPct(s?.planogram_rate ?? null), href: reportHref("perfect_store", range, "trends") },
    {
      label: `Check-ins far from the ${lower(t.site.one)}`,
      value: offsite.length,
      href: `/visits/off-site?${new URLSearchParams(rangeQuery(range)).toString()}`,
      tone: offsite.length > 0 ? ("bad" as const) : undefined,
    },
  ];

  function buildSheet(): ExportSheet {
    return {
      title: "Field team",
      context: [rangeLabel, ...(group ? [NOW_LABELS[group]] : []), ...(search.trim() ? [`Matching "${search.trim()}"`] : [])],
      filename: "field-team",
      columns: [
        { header: t.staff.one, key: "name" },
        { header: "Now", key: "where" },
        { header: `${t.job.many} done`, key: "done", numeric: true },
        { header: `${t.job.many} planned`, key: "planned", numeric: true },
        { header: `${t.site.many} visited`, key: "sites", numeric: true },
        { header: "Days worked", key: "days", numeric: true },
        { header: "Average start", key: "start" },
        { header: "Check-ins far from site", key: "offsite", numeric: true },
      ],
      rows: shown.map((p) => ({
        name: p.name,
        where: p.where,
        done: p.visitsDone,
        planned: p.visitsPlanned,
        sites: p.storesVisited,
        days: p.daysWorked,
        start: formatTimeOfDay(p.avgStart),
        offsite: p.offsite,
      })),
    };
  }

  const noScores = failed.scores;
  const noDays = failed.days;
  const noOffsite = failed.offsite;
  const missingFigures = [
    ...(noScores ? [`${lower(t.job.many)} done`] : []),
    ...(noDays ? ["days worked"] : []),
    ...(noOffsite ? ["far check-ins"] : []),
  ];
  const maxVisits = Math.max(1, ...inView.map((p) => p.visitsDone));
  const maxDays = Math.max(1, ...inView.map((p) => p.daysWorked));

  return (
    <div className="space-y-4">
      <DetailHeader
        title="Field team"
        subtitle={`Where each ${lower(t.staff.one)} is now, and what each one did over the period. Open a name to see their day.`}
        action={<ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />}
      />

      <DateRangePicker value={range} onChange={changeRange} />

      <TopCard>
        <TilePicker tiles={tiles} active={group} onChoose={(id) => chooseGroup(id as NowGroup | null)} label="Who" allowNone loading={loading || !config} />
        <p className="text-sm text-foreground">{loading || !config ? "\u00a0" : meaning}</p>
        {!loading && missingFigures.length > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Could not load {missingFigures.join(", ")} for this period, so those columns show a dash, not a nought.
          </p>
        )}
        <FigureStrip figures={figures} />
      </TopCard>

      {!loading && !error && people.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <InsightPanel
            title={`${t.job.many} done`}
            caption={rangeLabel}
            lines={[...inView]
              .sort((a, b) => b.visitsDone - a.visitsDone)
              .map((p) => ({
                id: p.id,
                label: p.name,
                value: p.visitsPlanned > p.visitsDone ? `${p.visitsDone} of ${p.visitsPlanned}` : p.visitsDone,
                bar: p.visitsDone / maxVisits,
              }))}
            active={activePerson}
            onToggle={(id) => setPerson(activePerson === id ? "" : id)}
            limit={10}
            moreHint="Search the list below to find one."
            empty={`No ${lower(t.job.many)} in this period.`}
            footnote={`Completed ${lower(t.job.many)}, and how many there were in all when not every one was done.`}
          />
          <InsightPanel
            title="Days worked"
            caption={rangeLabel}
            lines={[...inView]
              .sort((a, b) => b.daysWorked - a.daysWorked)
              .map((p) => ({
                id: p.id,
                label: p.name,
                value: p.avgStart === null ? p.daysWorked : `${p.daysWorked} · ${formatTimeOfDay(p.avgStart)}`,
                bar: p.daysWorked / maxDays,
              }))}
            active={activePerson}
            onToggle={(id) => setPerson(activePerson === id ? "" : id)}
            limit={10}
            moreHint="Search the list below to find one."
            empty="Nobody worked in this period."
            footnote="Days with any work recorded, and the average time the day started."
          />
        </div>
      )}

      <ListTools search={search} onSearch={setSearch} placeholder={`Find a ${lower(t.staff.one)}`}>
        {activePerson && (
          <FilterChip onClear={() => setPerson("")}>{people.find((p) => p.id === activePerson)?.name} only · everyone</FilterChip>
        )}
      </ListTools>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label={t.staff.one} sortKey="name" sort={sort} onSort={chooseSort} />
              <TableHead className="hidden md:table-cell">Now</TableHead>
              <SortHead label={`${t.job.many} done`} sortKey="visits" sort={sort} onSort={chooseSort} className="text-right" />
              <TableHead className="hidden text-right lg:table-cell">{t.site.many}</TableHead>
              <SortHead label="Days worked" sortKey="days" sort={sort} onSort={chooseSort} className="hidden text-right sm:table-cell" />
              <TableHead className="hidden text-right lg:table-cell">Starts</TableHead>
              <SortHead label="Far check-ins" sortKey="offsite" sort={sort} onSort={chooseSort} className="hidden text-right sm:table-cell" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Loading the team…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm">
                  <p className="font-medium text-destructive">Could not load the team</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={retry}>
                    Try again
                  </Button>
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {inView.length === 0 ? `No ${lower(t.staff.many)} here right now.` : `No ${lower(t.staff.many)} match.`}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(trackingHref(p.id))}>
                  <TableCell className="min-w-[140px] whitespace-normal text-sm">
                    <span className="flex items-center gap-2">
                      {p.freshness ? (
                        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[p.freshness]}`} aria-hidden />
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-red-600" aria-hidden />
                      )}
                      <Link href={trackingHref(p.id)} className="font-medium text-primary hover:underline">
                        {p.name}
                      </Link>
                    </span>
                    <span className="block pl-4 text-xs text-muted-foreground md:hidden">{p.where}</span>
                  </TableCell>
                  <TableCell className={`hidden max-w-[280px] truncate text-sm md:table-cell ${p.now === "silent" ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                    {p.where}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {noScores ? "-" : p.visitsDone}
                    {!noScores && p.visitsPlanned > p.visitsDone && <span className="font-normal text-muted-foreground"> of {p.visitsPlanned}</span>}
                  </TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground lg:table-cell">{noScores ? "-" : p.storesVisited}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums sm:table-cell">{noDays ? "-" : p.daysWorked}</TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground lg:table-cell">{formatTimeOfDay(p.avgStart)}</TableCell>
                  <TableCell
                    className={`hidden text-right text-sm tabular-nums sm:table-cell ${p.offsite > 0 ? "font-medium text-red-700 dark:text-red-400" : "text-muted-foreground"}`}
                  >
                    {noOffsite ? "-" : p.offsite}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {rangeLabel}. Far check-ins are more than the company&apos;s off-site distance from a confirmed {lower(t.site.one)} position.
        </p>
      )}
    </div>
  );
}
