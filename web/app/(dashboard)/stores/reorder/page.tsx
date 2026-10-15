"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExportMenu } from "@/components/export-menu";
import { Button } from "@/components/ui/button";
import {
  DetailHeader,
  FilterChip,
  InsightPanel,
  ListTools,
  SortHead,
  TilePicker,
  TopCard,
  type Tile,
} from "@/components/dashboard/detail-page";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { reorderGroupFromQuery, storeHref, type ReorderGroup } from "@/lib/dashboard-links";
import { localDay } from "@/lib/dashboard-numbers";
import { shiftDay } from "@/lib/dashboard";
import type { ExportSheet } from "@/lib/export";
import {
  DEFAULT_REORDER_DAYS,
  NEXT_VISIT_DAYS,
  REORDER_TILES,
  defaultSort,
  describeDue,
  emptyGroup,
  fetchNextVisits,
  fetchStoreReorder,
  groupLabel,
  groupMeaning,
  lastOrderProgress,
  orderLabel,
  orderRhythm,
  reorderStatus,
  sortRows,
  type NextVisit,
  type Sort,
  type SortKey,
  type StoreReorderRow,
} from "@/lib/store-reorder";
import { describeDays } from "@/lib/store-health";
import { createClient } from "@/lib/supabase/client";
import { count, lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

/** The "Next visit" line for stores nobody is going to in the next two weeks. */
const NONE_PLANNED = "none";
/** The "Next visit" line for a planned visit nobody has been given yet. */
const NOBODY_YET = "nobody";

/** Which "Next visit" line a store falls on. */
function visitLine(v: NextVisit | undefined): string {
  return v ? (v.repId ?? NOBODY_YET) : NONE_PLANNED;
}

/** "2026-09-19" as "19 Sep", with the year when it is not this year's. */
function shortDay(day: string, today: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Stores due for an order (owner, 15 Oct 2026: "prompts the manager with this
 * list of stores that need orders again - to improve sales").
 *
 * The same rows and rules the reps' phones use (`store_reorder`), split into
 * what to do: due now, due within a week, stopped ordering, never ordered, not
 * due yet. Beside each store, its next planned visit, so the stores that are
 * due and that nobody is going to are one tap away.
 */
export default function StoreReorderPage() {
  const t = useTerms();
  const config = useCompanyConfig();
  const zone = config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDay(zone);
  const rule = config?.settings.reorder_after_days ?? DEFAULT_REORDER_DAYS;

  const [rows, setRows] = useState<StoreReorderRow[]>([]);
  const [visits, setVisits] = useState<Map<string, NextVisit>>(new Map());
  const [visitsFailed, setVisitsFailed] = useState(false);
  /** Full names by profile id; empty for somebody who never gave one. */
  const [names, setNames] = useState<Record<string, string>>({});
  const nameOf = (id: string) => names[id] || `Unnamed ${lower(t.staff.one)}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<ReorderGroup | null>(null);
  /** One person's next visits, or NONE_PLANNED; "" for everyone. */
  const [person, setPerson] = useState("");
  const [town, setTown] = useState("");
  const [search, setSearch] = useState("");
  const [chosenSort, setChosenSort] = useState<Sort | null>(null);
  const [attempt, setAttempt] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only: the tiles own the group from here.
    setAsked(reorderGroupFromQuery(new URLSearchParams(window.location.search)));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The stores, and the next two weeks of planned visits. A failure reading
  // the visits costs that column, not the list.
  useEffect(() => {
    if (!config) return;
    let stale = false;
    const supabase = createClient();
    const day = localDay(config.timezone);
    Promise.all([
      fetchStoreReorder(supabase),
      fetchNextVisits(supabase, day, shiftDay(day, NEXT_VISIT_DAYS - 1)).catch(() => null),
    ])
      .then(async ([reorder, next]) => {
        const ids = [...new Set([...(next?.values() ?? [])].map((v) => v.repId).filter((id): id is string => id !== null))];
        const { data } = ids.length === 0 ? { data: [] } : await supabase.from("profiles").select("id, full_name").in("id", ids);
        if (stale) return;
        setRows(reorder);
        setVisits(next ?? new Map());
        setVisitsFailed(next === null);
        setNames(Object.fromEntries(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? ""])));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [config, attempt]);

  const group: ReorderGroup = asked ?? "due";
  const sort = chosenSort ?? defaultSort(group);

  function chooseGroup(next: ReorderGroup) {
    setAsked(next);
    setChosenSort(null);
    setPerson("");
    setTown("");
    // In the address, so a reload, a shared link or Back opens the same list.
    const url = new URL(window.location.href);
    url.searchParams.set("show", next);
    window.history.replaceState(null, "", url);
  }

  function chooseSort(key: SortKey) {
    setChosenSort(
      sort.key === key
        ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "due" || key === "visit" || key === "usual" ? "asc" : "desc" }
    );
  }

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }

  const counts = useMemo(() => {
    const c = { due: 0, soon: 0, stopped: 0, never: 0, not_due: 0 } as Record<ReorderGroup, number>;
    for (const r of rows) c[reorderStatus(r, today).state] += 1;
    return c;
  }, [rows, today]);
  const inThisGroup = useMemo(() => rows.filter((r) => reorderStatus(r, today).state === group), [rows, today, group]);

  /** "Next visit": who is going to this group's stores in the next two weeks, and how many nobody is. */
  const byVisit = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inThisGroup) {
      const id = visitLine(visits.get(r.store_id));
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([id, n]) => ({
        id,
        n,
        name: id === NONE_PLANNED ? `No ${lower(t.job.one)} planned` : id === NOBODY_YET ? "Planned, nobody given it yet" : nameOf(id),
      }))
      .sort((a, b) => Number(a.id === NONE_PLANNED) - Number(b.id === NONE_PLANNED) || b.n - a.n || a.name.localeCompare(b.name));
    // nameOf reads `names`, which is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inThisGroup, visits, names, t.job.one]);

  /** "By town": where this group's stores are, the most first. */
  const byTown = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inThisGroup) {
      const c = r.city?.trim() || "No town recorded";
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inThisGroup]);

  const activePerson = byVisit.some((p) => p.id === person) ? person : "";
  const activeTown = byTown.some(([c]) => c === town) ? town : "";
  const noneMax = Math.max(1, ...byVisit.map((p) => p.n));

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inThisGroup.filter((r) => {
      if (activePerson !== "" && visitLine(visits.get(r.store_id)) !== activePerson) return false;
      if (activeTown !== "" && (r.city?.trim() || "No town recorded") !== activeTown) return false;
      if (!q) return true;
      return r.store_name.toLowerCase().includes(q) || (r.city ?? "").toLowerCase().includes(q);
    });
    return sortRows(filtered, sort, today, (id) => visits.get(id)?.day ?? null);
  }, [inThisGroup, visits, activePerson, activeTown, search, sort, today]);

  /** "Tomorrow, Thabo Molefe"; null when nothing is planned (or the plan could not be read: ""). */
  function nextVisitText(r: StoreReorderRow): string | null {
    const v = visits.get(r.store_id);
    if (!v) return visitsFailed ? "" : null;
    const when = v.day === today ? "Today" : v.day === shiftDay(today, 1) ? "Tomorrow" : shortDay(v.day, today);
    return v.repId ? `${when}, ${nameOf(v.repId)}` : when;
  }

  function buildSheet(): ExportSheet {
    const who =
      activePerson === NONE_PLANNED
        ? `No ${lower(t.job.one)} planned in the next two weeks`
        : activePerson
          ? `Next ${lower(t.job.one)} with ${nameOf(activePerson)}`
          : `Every ${lower(t.site.one)} in this group`;
    return {
      title: `${t.site.many} due for an order: ${groupLabel(group)}`,
      context: [
        groupMeaning(group, t, rule),
        who,
        ...(activeTown ? [`Town: ${activeTown}`] : []),
        ...(search.trim() ? [`Matching "${search.trim()}"`] : []),
      ],
      filename: "stores-due-for-an-order",
      columns: [
        { header: t.site.one, key: "site" },
        { header: "Town", key: "town" },
        { header: "Last order", key: "last" },
        { header: "Days since an order", key: "days", numeric: true },
        { header: "Order or invoice", key: "ref" },
        { header: "Usually orders", key: "usual" },
        { header: "Due", key: "due" },
        { header: "Orders in the last year", key: "orders", numeric: true },
        { header: `Next ${lower(t.job.one)}`, key: "visit" },
      ],
      rows: shown.map((r) => {
        const s = reorderStatus(r, today);
        return {
          site: r.store_name,
          town: r.city ?? "",
          last: r.last_order_on ?? "Never",
          days: s.daysSince,
          ref: orderLabel(r),
          usual: r.usual_days === null ? "" : orderRhythm(r.usual_days),
          due: describeDue(s),
          orders: r.order_days_year,
          visit: nextVisitText(r) ?? "None planned",
        };
      }),
    };
  }

  const total = rows.length;
  const tiles: Tile[] = REORDER_TILES.map((g) => ({
    id: g,
    label: groupLabel(g),
    value: counts[g],
    tone: g === "stopped" && counts[g] > 0 ? "bad" : g === "due" && counts[g] > 0 ? "warn" : g === "not_due" ? "good" : undefined,
  }));
  const colSpan = 5;

  return (
    <div className="space-y-4">
      <DetailHeader
        title={`${t.site.many} due for an order`}
        subtitle={`When each ${lower(t.site.one)} last ordered, how often it usually orders, and who is due. A ${lower(t.site.one)} is due after ${rule} days without an order, or sooner if it usually orders sooner. Your team sees the same on their phones.`}
        action={<ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />}
      />

      <TopCard>
        {total > 0 && (
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            <div className="bg-emerald-600" style={{ flex: counts.not_due / total }} />
            <div className="bg-amber-300" style={{ flex: counts.soon / total }} />
            <div className="bg-amber-500" style={{ flex: counts.due / total }} />
            <div className="bg-red-600" style={{ flex: counts.stopped / total }} />
            <div className="bg-muted-foreground/25" style={{ flex: counts.never / total }} />
          </div>
        )}
        <TilePicker
          tiles={tiles}
          active={group}
          onChoose={(id) => id && chooseGroup(id as ReorderGroup)}
          label={`Which ${lower(t.site.many)}`}
          loading={loading}
        />
        <p className="text-sm text-foreground">{groupMeaning(group, t, rule)}</p>
      </TopCard>

      {!loading && !error && rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <InsightPanel
            title={`Next ${lower(t.job.one)}`}
            caption={`${groupLabel(group)}, next ${NEXT_VISIT_DAYS} days`}
            lines={byVisit.map((p) => ({
              id: p.id,
              label: p.name,
              value: p.n,
              bar: p.n / noneMax,
              aside: p.id === NONE_PLANNED ? "warn" : undefined,
            }))}
            active={activePerson}
            onToggle={(id) => setPerson(activePerson === id ? "" : id)}
            limit={12}
            empty={emptyGroup(group, t)}
            footnote={
              visitsFailed
                ? `The planned ${lower(t.job.many)} could not be read, so every ${lower(t.site.one)} shows as not planned.`
                : `Who is going to these ${lower(t.site.many)} next. Tap "No ${lower(t.job.one)} planned" to see the ones nobody is going to, and add them to someone's schedule.`
            }
          />
          <InsightPanel
            title="By town"
            caption={groupLabel(group)}
            lines={byTown.map(([c, n]) => ({
              id: c,
              label: c,
              value: n,
              bar: n / (byTown[0]?.[1] ?? 1),
              aside: c === "No town recorded" ? "muted" : undefined,
            }))}
            active={activeTown}
            onToggle={(id) => setTown(activeTown === id ? "" : id)}
            empty={emptyGroup(group, t)}
            moreHint="Search the list below to find one."
          />
        </div>
      )}

      <ListTools search={search} onSearch={setSearch} placeholder={`Find a ${lower(t.site.one)} or town`}>
        {activePerson !== "" && (
          <FilterChip onClear={() => setPerson("")}>
            {activePerson === NONE_PLANNED ? `No ${lower(t.job.one)} planned` : `${nameOf(activePerson)}'s next ${lower(t.job.many)}`} · show everyone
          </FilterChip>
        )}
        {activeTown !== "" && <FilterChip onClear={() => setTown("")}>{activeTown} only · every town</FilterChip>}
      </ListTools>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label={t.site.one} sortKey="name" sort={sort} onSort={chooseSort} />
              <SortHead label="Last order" sortKey="last" sort={sort} onSort={chooseSort} />
              <SortHead label="Usually orders" sortKey="usual" sort={sort} onSort={chooseSort} className="hidden md:table-cell" />
              <SortHead label="Orders in a year" sortKey="orders" sort={sort} onSort={chooseSort} className="hidden text-right lg:table-cell" />
              <SortHead label={`Next ${lower(t.job.one)}`} sortKey="visit" sort={sort} onSort={chooseSort} className="hidden sm:table-cell" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
                  Loading {lower(t.site.many)}…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-sm">
                  <p className="font-medium text-destructive">Could not load the {lower(t.site.many)}</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={retry}>
                    Try again
                  </Button>
                </TableCell>
              </TableRow>
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
                  {inThisGroup.length === 0 ? (
                    emptyGroup(group, t)
                  ) : (
                    <>
                      No {lower(t.site.many)} match.{" "}
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => {
                          setSearch("");
                          setPerson("");
                          setTown("");
                        }}
                      >
                        Show them all
                      </button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => {
                const s = reorderStatus(r, today);
                const due = describeDue(s);
                const progress = lastOrderProgress(r.last_order_status);
                const visit = nextVisitText(r);
                return (
                  <TableRow key={r.store_id}>
                    <TableCell className="min-w-[140px] whitespace-normal text-sm sm:min-w-[200px]">
                      <Link href={storeHref(r.store_id)} className="font-medium text-primary hover:underline">
                        {r.store_name}
                      </Link>
                      {r.city && <span className="block text-xs text-muted-foreground">{r.city}</span>}
                      {/* The next visit is its own column from sm up; below that it rides under the name. */}
                      {visit !== "" && (
                        <span
                          className={`block text-xs sm:hidden ${
                            visit === null ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
                          }`}
                        >
                          Next {lower(t.job.one)}: {visit ?? "None planned"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm" title={r.last_order_on ? shortDay(r.last_order_on, today) : undefined}>
                      <span className="font-medium tabular-nums text-foreground">{describeDays(s.daysSince)}</span>
                      {r.last_order_on && (
                        <span className="block text-xs text-muted-foreground">
                          {shortDay(r.last_order_on, today)} · {orderLabel(r)}
                          {progress ? `, ${progress}` : ""}
                        </span>
                      )}
                      {due && (
                        <span
                          className={`block text-xs ${
                            s.state === "stopped"
                              ? "text-red-700 dark:text-red-400"
                              : s.state === "due"
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          {due}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {r.usual_days === null ? (
                        <span title="Fewer than three orders in the last year">Not known yet</span>
                      ) : (
                        orderRhythm(r.usual_days)
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground lg:table-cell">
                      {r.order_days_year}
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {visit === null ? (
                        <span className="italic text-amber-700 dark:text-amber-400">None planned</span>
                      ) : (
                        <span className="text-muted-foreground">{visit}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {shown.length === inThisGroup.length
            ? `${count(t, "site", shown.length)}.`
            : `${shown.length.toLocaleString()} of ${count(t, "site", inThisGroup.length)}.`}{" "}
          An order is any order that was not cancelled, and the invoices brought over from QuickBooks. How often a{" "}
          {lower(t.site.one)} usually orders needs three orders in the last year. Next {lower(t.job.one)} looks{" "}
          {NEXT_VISIT_DAYS} days ahead.
        </p>
      )}
    </div>
  );
}
