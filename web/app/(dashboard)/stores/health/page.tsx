"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { healthGroupFromQuery, storeHref, type HealthGroup } from "@/lib/dashboard-links";
import { toLocalDate } from "@/lib/date-range";
import type { ExportSheet } from "@/lib/export";
import { moduleEnabled } from "@/lib/modules";
import { fetchAssignments, type Assignment } from "@/lib/representatives";
import {
  defaultSort,
  describeDays,
  fetchStoreHealth,
  groupLabel,
  groupMeaning,
  groupsFor,
  inGroup,
  sortRows,
  type Sort,
  type SortKey,
  type StoreHealthRow,
} from "@/lib/store-health";
import { createClient } from "@/lib/supabase/client";
import { count, lower, type Terms } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

/** "" is everyone; this is the chip for stores nobody is assigned to. */
const UNASSIGNED = "unassigned";
/** A line of the "By rep" and "By town" panels: name, bar, figure. */
const INSIGHT_ROW =
  "-mx-1.5 grid w-[calc(100%+0.75rem)] grid-cols-[minmax(6rem,9rem)_1fr_2.5rem] items-center gap-3 rounded-md px-1.5 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring";
/** A filter that is on, said in words, and the way to take it off. */
const FILTER_CHIP = "rounded-full border border-primary/40 px-3 py-1 text-xs text-primary hover:bg-primary/5";
/** The "By town" line for stores with no town recorded. */
const NO_TOWN = "No town recorded";

/**
 * The Store health card, opened up: the stores behind each of its numbers.
 *
 * Opened from the card with the group in the URL (`?show=not_visited`), so the
 * list answers the number that was clicked. The groups and their counts come
 * from `store_health`, the function the card itself counts, so the two always
 * agree. Each store opens on the stores list, where it can be given to someone.
 */
export default function StoreHealthPage() {
  const t = useTerms();
  const config = useCompanyConfig();
  // Assumed on until the config loads, as on the dashboard, so Gold Fortune's
  // page does not flicker from two groups to four.
  const sells = config ? moduleEnabled(config.modules, "distribution") : true;
  const groups = useMemo(() => groupsFor(sells), [sells]);

  const [rows, setRows] = useState<StoreHealthRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  /** Full names by profile id; empty for somebody who never gave one. */
  const [names, setNames] = useState<Record<string, string>>({});
  const nameOf = (id: string) => names[id] || `Unnamed ${lower(t.staff.one)}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<HealthGroup | null>(null);
  const [person, setPerson] = useState("");
  /** One town, from the "By town" panel; "" for every town. */
  const [town, setTown] = useState("");
  const [search, setSearch] = useState("");
  /** Null until a heading is clicked: each group then opens in its own order. */
  const [chosenSort, setChosenSort] = useState<Sort | null>(null);
  const [attempt, setAttempt] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only, as on the off-site list: the tabs own the group from here.
    setAsked(healthGroupFromQuery(new URLSearchParams(window.location.search)));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let stale = false;
    const supabase = createClient();
    // Who covers each store, then just those people's names. A store with
    // nobody on it is the first thing a manager fixes, so a failure here costs
    // the column, not the list.
    const people = fetchAssignments(supabase)
      .catch(() => [] as Assignment[])
      .then(async (assigned) => {
        const ids = [...new Set(assigned.map((a) => a.rep_id))];
        if (ids.length === 0) return { assigned, people: [] as { id: string; full_name: string | null }[] };
        const { data } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        return { assigned, people: (data ?? []) as { id: string; full_name: string | null }[] };
      });
    Promise.all([fetchStoreHealth(supabase), people.then((p) => p.assigned), people.then((p) => p.people)])
      .then(([health, assigned, people]) => {
        if (stale) return;
        setRows(health);
        setAssignments(assigned);
        setNames(Object.fromEntries(people.map((p) => [p.id, p.full_name ?? ""])));
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
  }, [attempt]);

  /** A group this company is shown, falling back to the one the headline opens. */
  const group: HealthGroup = asked !== null && groups.includes(asked) ? asked : "not_visited";
  const sort = chosenSort ?? defaultSort(group);

  function chooseGroup(next: HealthGroup) {
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
    setChosenSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" });
  }

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }

  /** Each store's people, the main one first. */
  const peopleOf = useMemo(() => {
    const m = new Map<string, string[]>();
    const ordered = [...assignments].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    for (const a of ordered) m.set(a.store_id, [...(m.get(a.store_id) ?? []), a.rep_id]);
    return m;
  }, [assignments]);

  const counts = useMemo(
    () => Object.fromEntries(groups.map((g) => [g, rows.filter((r) => inGroup(r, g)).length])) as Record<HealthGroup, number>,
    [rows, groups]
  );
  const inThisGroup = useMemo(() => rows.filter((r) => inGroup(r, group)), [rows, group]);

  /**
   * "By rep": each person's stores split the way the card splits the estate,
   * so the owner sees at a glance whose stores are going quiet. Counted over
   * every store they cover; the figure beside the bar is this group's.
   */
  const byPerson = useMemo(() => {
    type Split = { id: string; name: string; ordering: number; no_order: number; not_visited: number; total: number; inGroup: number };
    const m = new Map<string, Split>();
    const add = (id: string, name: string, r: StoreHealthRow) => {
      const cur = m.get(id) ?? { id, name, ordering: 0, no_order: 0, not_visited: 0, total: 0, inGroup: 0 };
      cur[r.status] += 1;
      cur.total += 1;
      if (inGroup(r, group)) cur.inGroup += 1;
      m.set(id, cur);
    };
    for (const r of rows) {
      const ids = peopleOf.get(r.store_id) ?? [];
      if (ids.length === 0) add(UNASSIGNED, "Unassigned", r);
      for (const id of ids) add(id, names[id] || `Unnamed ${lower(t.staff.one)}`, r);
    }
    return [...m.values()].sort(
      (a, b) => Number(a.id === UNASSIGNED) - Number(b.id === UNASSIGNED) || b.inGroup - a.inGroup || a.name.localeCompare(b.name)
    );
  }, [rows, peopleOf, names, group, t.staff.one]);

  /** "By town": where this group's stores are, the most first. */
  const byTown = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inThisGroup) {
      const c = r.city?.trim() || NO_TOWN;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [inThisGroup]);

  // A person or town picked under another group may have nothing in this one.
  const activePerson = byPerson.some((p) => p.id === person && p.inGroup > 0) ? person : "";
  const activeTown = byTown.some(([c]) => c === town) ? town : "";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inThisGroup.filter((r) => {
      const ids = peopleOf.get(r.store_id) ?? [];
      if (activePerson === UNASSIGNED && ids.length > 0) return false;
      if (activePerson !== "" && activePerson !== UNASSIGNED && !ids.includes(activePerson)) return false;
      if (activeTown !== "" && (r.city?.trim() || NO_TOWN) !== activeTown) return false;
      if (!q) return true;
      return r.store_name.toLowerCase().includes(q) || (r.city ?? "").toLowerCase().includes(q);
    });
    return sortRows(filtered, sort);
  }, [inThisGroup, peopleOf, activePerson, activeTown, search, sort]);

  function responsible(r: StoreHealthRow): string {
    const ids = peopleOf.get(r.store_id) ?? [];
    return ids.map(nameOf).join(", ");
  }

  function buildSheet(): ExportSheet {
    const who =
      activePerson === UNASSIGNED
        ? "Unassigned only"
        : activePerson
          ? `${t.staff.one}: ${nameOf(activePerson)}`
          : `All ${lower(t.staff.many)}`;
    return {
      title: `${t.site.one} health: ${groupLabel(group)}`,
      context: [
        groupMeaning(group, t),
        who,
        ...(activeTown ? [`Town: ${activeTown}`] : []),
        ...(search.trim() ? [`Matching "${search.trim()}"`] : []),
      ],
      filename: "store-health",
      columns: [
        { header: t.site.one, key: "site" },
        { header: "Town", key: "town" },
        { header: "Responsible", key: "people" },
        { header: `Last ${lower(t.job.one)}`, key: "visit" },
        { header: `Days since a ${lower(t.job.one)}`, key: "visitDays", numeric: true },
        ...(sells
          ? [
              { header: "Last order", key: "order" },
              { header: "Days since an order", key: "orderDays", numeric: true },
              { header: "Orders placed", key: "orders", numeric: true },
            ]
          : []),
      ],
      rows: shown.map((r) => ({
        site: r.store_name,
        town: r.city ?? "",
        people: responsible(r),
        visit: r.last_visit_at ? toLocalDate(r.last_visit_at) : "Never",
        visitDays: r.days_since_visit,
        order: r.last_order_at ? toLocalDate(r.last_order_at) : "Never",
        orderDays: r.days_since_order,
        orders: r.orders_ever,
      })),
    };
  }

  const colSpan = sells ? 5 : 3;
  // The column the group is about reads darker than the rest.
  const keyColumn: SortKey = group === "not_visited" || group === "visited" ? "visit" : group === "lapsed" ? "orders" : "order";
  /**
   * On a phone only one of the two "last" columns fits beside the name: the
   * one the group is about. A stopped-ordering store is about its orders.
   */
  const dayKey: SortKey = keyColumn === "visit" ? "visit" : "order";
  const onPhone = (col: "visit" | "order") => (sells && col !== dayKey ? "hidden sm:table-cell" : "");
  const total = rows.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t.site.one} health</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {sells
              ? `Who is ordering, who is visited without ordering, and where nobody has been. The last 30 days, counted the same way as the dashboard.`
              : `Which ${lower(t.site.many)} had a ${lower(t.job.one)} in the last 30 days, and where nobody has been.`}
          </p>
        </div>
        <ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />
      </div>

      <Card className="flex flex-col gap-4 p-5">
      {sells && total > 0 && (
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          <div className="bg-emerald-600" style={{ flex: counts.ordering / total }} />
          <div className="bg-muted-foreground/25" style={{ flex: counts.no_order / total }} />
          <div className="bg-red-600" style={{ flex: counts.not_visited / total }} />
        </div>
      )}

      <div role="group" aria-label={`Which ${lower(t.site.many)}`} className={`grid grid-cols-2 gap-2 ${groups.length === 4 ? "lg:grid-cols-4" : ""}`}>
        {groups.map((g) => {
          const active = g === group;
          const n = counts[g] ?? 0;
          const tone =
            g === "ordering"
              ? "text-emerald-700 dark:text-emerald-400"
              : g === "not_visited" && n > 0
                ? "text-red-700 dark:text-red-400"
                : "text-foreground";
          return (
            <button
              key={g}
              type="button"
              aria-pressed={active}
              onClick={() => chooseGroup(g)}
              className={`flex min-h-11 flex-col items-start gap-1 rounded-xl p-3 text-left transition-[background-color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:transition-none ${
                active ? "bg-primary/5 ring-2 ring-primary" : "bg-card ring-1 ring-foreground/10 hover:bg-muted/40"
              }`}
            >
              <span className="text-xs font-medium text-muted-foreground">{groupLabel(g)}</span>
              <span className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${tone}`}>{loading ? "\u00a0" : n}</span>
            </button>
          );
        })}
      </div>
      <p className="text-sm text-foreground">{groupMeaning(group, t)}</p>
      </Card>

      {/* The insights: whose stores, and where. Each line narrows the list below. */}
      {!loading && !error && rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-semibold">By {lower(t.staff.one)}</h2>
              <span className="text-xs text-muted-foreground">{groupLabel(group)}</span>
            </div>
            <ul className="flex flex-col">
              {byPerson.map((p) => {
                const active = activePerson === p.id;
                return (
                  <li key={p.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      aria-pressed={active}
                      disabled={p.inGroup === 0}
                      onClick={() => setPerson(active ? "" : p.id)}
                      className={`${INSIGHT_ROW} disabled:cursor-default ${active ? "bg-primary/10" : "enabled:hover:bg-muted/60"}`}
                    >
                      <span className={`truncate ${p.id === UNASSIGNED ? "italic text-amber-700 dark:text-amber-400" : ""}`}>{p.name}</span>
                      <span className="flex h-2.5 gap-px overflow-hidden rounded-full bg-muted" aria-hidden>
                        {sells ? (
                          <>
                            <span className="bg-emerald-600" style={{ flex: p.ordering }} />
                            <span className="bg-muted-foreground/25" style={{ flex: p.no_order }} />
                          </>
                        ) : (
                          <span className="bg-emerald-600" style={{ flex: p.ordering + p.no_order }} />
                        )}
                        <span className="bg-red-600" style={{ flex: p.not_visited }} />
                      </span>
                      <span className={`text-right font-semibold tabular-nums ${p.inGroup === 0 ? "text-muted-foreground" : ""}`}>{p.inGroup}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              The bar is all of their {lower(t.site.many)}. The number is how many are in this group. Tap a name to see only theirs.
            </p>
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-semibold">By town</h2>
              <span className="text-xs text-muted-foreground">{groupLabel(group)}</span>
            </div>
            {byTown.length === 0 ? (
              <p className="text-sm text-muted-foreground">{emptyGroup(group, t)}</p>
            ) : (
              <ul className="flex flex-col">
                {byTown.slice(0, 6).map(([c, n]) => {
                  const active = activeTown === c;
                  return (
                    <li key={c} className="border-b last:border-b-0">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setTown(active ? "" : c)}
                        className={`${INSIGHT_ROW} ${active ? "bg-primary/10" : "hover:bg-muted/60"}`}
                      >
                        <span className={`truncate ${c === NO_TOWN ? "italic text-muted-foreground" : ""}`}>{c}</span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(n / byTown[0][1]) * 100}%` }} />
                        </span>
                        <span className="text-right font-semibold tabular-nums">{n}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {byTown.length > 6 && (
              <p className="text-xs text-muted-foreground">
                And {byTown.length - 6} more {byTown.length - 6 === 1 ? "town" : "towns"}. Search the list below to find one.
              </p>
            )}
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Find a ${lower(t.site.one)} or town`}
            aria-label={`Find a ${lower(t.site.one)} or town`}
            className="pl-8"
          />
        </div>
        {activePerson !== "" && (
          <button type="button" onClick={() => setPerson("")} className={FILTER_CHIP}>
            {activePerson === UNASSIGNED ? "Unassigned only" : `${nameOf(activePerson)} only`} · show everyone
          </button>
        )}
        {activeTown !== "" && (
          <button type="button" onClick={() => setTown("")} className={FILTER_CHIP}>
            {activeTown} only · every town
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label={t.site.one} sortKey="name" sort={sort} onSort={chooseSort} />
              <TableHead className="hidden md:table-cell">Responsible</TableHead>
              <SortHead label={`Last ${lower(t.job.one)}`} sortKey="visit" sort={sort} onSort={chooseSort} className={onPhone("visit")} />
              {sells && <SortHead label="Last order" sortKey="order" sort={sort} onSort={chooseSort} className={onPhone("order")} />}
              {sells && (
                <SortHead
                  label="Orders"
                  sortKey="orders"
                  sort={sort}
                  onSort={chooseSort}
                  className={`text-right ${keyColumn === "orders" ? "" : "hidden sm:table-cell"}`}
                />
              )}
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
                const people = responsible(r);
                return (
                  <TableRow key={r.store_id}>
                    <TableCell className="min-w-[120px] whitespace-normal text-sm sm:min-w-[180px]">
                      <Link href={storeHref(r.store_id)} className="font-medium text-primary hover:underline">
                        {r.store_name}
                      </Link>
                      {r.city && <span className="block text-xs text-muted-foreground">{r.city}</span>}
                      {/* Responsible is its own column from md up; below that it rides under the name. */}
                      <span className="block text-xs text-muted-foreground md:hidden">{people || "Unassigned"}</span>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {people ? (
                        <span className="text-muted-foreground">{people}</span>
                      ) : (
                        <span className="italic text-amber-700 dark:text-amber-400">Unassigned</span>
                      )}
                    </TableCell>
                    <DaysCell days={r.days_since_visit} at={r.last_visit_at} strong={keyColumn === "visit"} className={onPhone("visit")} />
                    {sells && (
                      <DaysCell days={r.days_since_order} at={r.last_order_at} strong={keyColumn === "order"} className={onPhone("order")} />
                    )}
                    {sells && (
                      <TableCell
                        className={`text-right text-sm tabular-nums ${
                          keyColumn === "orders" ? "font-medium text-foreground" : "hidden text-muted-foreground sm:table-cell"
                        }`}
                      >
                        {r.orders_ever}
                      </TableCell>
                    )}
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
          A {lower(t.job.one)} is any check-in. An order is any order that was not cancelled.
        </p>
      )}
    </div>
  );
}

/** What an empty group means, said as good news where it is. */
function emptyGroup(group: HealthGroup, t: Terms): string {
  const site = lower(t.site.one);
  const job = lower(t.job.one);
  switch (group) {
    case "not_visited":
      return `Every ${site} had a ${job} in the last 30 days.`;
    case "no_order":
      return `Every ${site} that had a ${job} in the last 30 days also placed an order.`;
    case "ordering":
      return `No ${site} had a ${job} and placed an order in the last 30 days.`;
    case "lapsed":
      return `No ${site} has stopped ordering.`;
    case "visited":
      return `No ${site} had a ${job} in the last 30 days.`;
  }
}

/** "12 days ago", with the date itself on hover. */
function DaysCell({
  days,
  at,
  strong,
  className = "",
}: {
  days: number | null;
  at: string | null;
  strong: boolean;
  className?: string;
}) {
  return (
    <TableCell
      className={`whitespace-nowrap text-sm tabular-nums ${strong ? "font-medium text-foreground" : "text-muted-foreground"} ${className}`}
      title={at ? toLocalDate(at) : undefined}
    >
      {describeDays(days)}
    </TableCell>
  );
}

/** A heading that orders the list; the arrow says which way. */
function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-40"}`} aria-hidden />
      </button>
    </TableHead>
  );
}
