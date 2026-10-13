"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    Promise.all([
      fetchStoreHealth(supabase),
      // Who covers each store. A store with nobody on it is the first thing a
      // manager fixes, so a failure here costs the column, not the list.
      fetchAssignments(supabase).catch(() => [] as Assignment[]),
      supabase
        .from("profiles")
        .select("id, full_name")
        .then(({ data }) => (data ?? []) as { id: string; full_name: string | null }[]),
    ])
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

  /** Chips: everyone, then each person by how many of this group's stores they cover. */
  const chips = useMemo(() => {
    const byPerson = new Map<string, number>();
    let none = 0;
    for (const r of inThisGroup) {
      const ids = peopleOf.get(r.store_id) ?? [];
      if (ids.length === 0) none += 1;
      for (const id of ids) byPerson.set(id, (byPerson.get(id) ?? 0) + 1);
    }
    const people = [...byPerson.entries()]
      .map(([id, n]) => ({ id, name: names[id] || `Unnamed ${lower(t.staff.one)}`, n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    return { people, none };
  }, [inThisGroup, peopleOf, names, t.staff.one]);

  // A person picked under another group may cover nothing in this one.
  const activePerson =
    person === UNASSIGNED ? (chips.none > 0 ? UNASSIGNED : "") : chips.people.some((p) => p.id === person) ? person : "";

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inThisGroup.filter((r) => {
      const ids = peopleOf.get(r.store_id) ?? [];
      if (activePerson === UNASSIGNED && ids.length > 0) return false;
      if (activePerson !== "" && activePerson !== UNASSIGNED && !ids.includes(activePerson)) return false;
      if (!q) return true;
      return r.store_name.toLowerCase().includes(q) || (r.city ?? "").toLowerCase().includes(q);
    });
    return sortRows(filtered, sort);
  }, [inThisGroup, peopleOf, activePerson, search, sort]);

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
      context: [groupMeaning(group, t), who, ...(search.trim() ? [`Matching "${search.trim()}"`] : [])],
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
              ? `Which ${lower(t.site.many)} are ordering, which are visited without ordering, and which nobody has been to. Counted over the last 30 days, the same way as the dashboard.`
              : `Which ${lower(t.site.many)} had a ${lower(t.job.one)} in the last 30 days, and which nobody has been to.`}
          </p>
        </div>
        <ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />
      </div>

      {sells && total > 0 && (
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
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
              <span className={`text-2xl font-semibold leading-none tabular-nums ${tone}`}>{loading ? " " : n}</span>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-foreground">{groupMeaning(group, t)}</p>

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
        {(chips.people.length > 0 || chips.none > 0) && (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={activePerson === "" ? "default" : "outline"} onClick={() => setPerson("")}>
              Everyone · {inThisGroup.length}
            </Button>
            {chips.people.map((p) => (
              <Button key={p.id} size="sm" variant={activePerson === p.id ? "default" : "outline"} onClick={() => setPerson(p.id)}>
                {p.name} · {p.n}
              </Button>
            ))}
            {chips.none > 0 && (
              <Button size="sm" variant={activePerson === UNASSIGNED ? "default" : "outline"} onClick={() => setPerson(UNASSIGNED)}>
                Unassigned · {chips.none}
              </Button>
            )}
          </div>
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
                      <Link href={storeHref(r.store_name)} className="font-medium text-primary hover:underline">
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
