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
  DECLINE_DAYS,
  DECLINE_REASONS,
  DEFAULT_REORDER_DAYS,
  NEXT_VISIT_DAYS,
  REORDER_TILES,
  defaultSort,
  describeDue,
  emptyGroup,
  fetchDeclines,
  fetchNextVisits,
  fetchStorePhones,
  fetchStoreReorder,
  fetchYearSales,
  dayLabel,
  standingDeclines,
  groupLabel,
  groupMeaning,
  lastOrderProgress,
  orderLabel,
  orderRhythm,
  reorderStatus,
  sortRows,
  type Decline,
  type DeclineReason,
  type NextVisit,
  type Sort,
  type SortKey,
  type StoreReorderRow,
} from "@/lib/store-reorder";
import { describeDays } from "@/lib/store-health";
import { formatMoneyShort } from "@/lib/money";
import { formatPhone } from "@/lib/phone-login";
import { useIsManager } from "@/lib/use-is-manager";
import { PlanVisitsDialog } from "@/components/stores/plan-visits-dialog";
import { StoreGroupChip, StoreGroupPicker } from "@/components/dashboard/store-group-picker";
import { useStoreGroupFilter } from "@/lib/use-store-group-filter";
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
  /** The stores themselves; `loading` below also waits for a store group a link asked for. */
  const [loadingRows, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<ReorderGroup | null>(null);
  /** One person's next visits, or NONE_PLANNED; "" for everyone. */
  const [person, setPerson] = useState("");
  const [town, setTown] = useState("");
  const [search, setSearch] = useState("");
  const [chosenSort, setChosenSort] = useState<Sort | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Every reason given in the last DECLINE_DAYS, newest first. */
  const [declines, setDeclines] = useState<Decline[]>([]);
  /** What each store bought in a year; null when this person may not see money. */
  const [sales, setSales] = useState<Map<string, number> | null>(null);
  const [salesFailed, setSalesFailed] = useState(false);
  const [phones, setPhones] = useState<Map<string, { name: string; phone: string }>>(new Map());
  /** One reason from the "Why no order" panel; "" for all. */
  const [reasonFilter, setReasonFilter] = useState("");
  /** The stores the plan dialog is open for; empty when it is closed. */
  const [planning, setPlanning] = useState<{ id: string; name: string }[]>([]);
  const [planned, setPlanned] = useState<string | null>(null);
  const isManager = useIsManager();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only: the tiles own the tile (`?show=`) from here. The store
    // group (`?group=`) is useStoreGroupFilter's.
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
    // Only the stores are needed for the page to be useful; the rest add to it
    // and each costs its own column or panel when it cannot be read.
    Promise.all([
      fetchStoreReorder(supabase),
      fetchNextVisits(supabase, day, shiftDay(day, NEXT_VISIT_DAYS - 1)).catch(() => null),
      fetchDeclines(supabase, new Date(Date.now() - DECLINE_DAYS * 86_400_000)).catch(() => [] as Decline[]),
      fetchYearSales(supabase).catch(() => undefined),
      fetchStorePhones(supabase).catch(() => new Map<string, { name: string; phone: string }>()),
    ])
      .then(async ([reorder, next, given, bought, numbers]) => {
        const ids = [
          ...new Set(
            [...[...(next?.values() ?? [])].map((v) => v.repId), ...given.map((d) => d.rep_id)].filter(
              (id): id is string => id !== null
            )
          ),
        ];
        const { data } = ids.length === 0 ? { data: [] } : await supabase.from("profiles").select("id, full_name").in("id", ids);
        if (stale) return;
        setRows(reorder);
        setDeclines(given);
        // undefined: it failed, which is said; null: no permission, which is not.
        setSales(bought ?? null);
        setSalesFailed(bought === undefined);
        setPhones(numbers);
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
  const sort = chosenSort ?? defaultSort(group, sales !== null);

  function chooseGroup(next: ReorderGroup) {
    setAsked(next);
    setChosenSort(null);
    setPerson("");
    setTown("");
    setReasonFilter("");
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

  /** One store group's stores, or every store: what the tiles, panels and list count. */
  const storeGroup = useStoreGroupFilter(rows, t, {
    key: "store_id",
    onChoose: () => {
      setPerson("");
      setTown("");
      setReasonFilter("");
    },
  });
  const inStoreGroup = storeGroup.rows;
  const loading = loadingRows || storeGroup.loading;

  const counts = useMemo(() => {
    const c = { due: 0, soon: 0, stopped: 0, never: 0, not_due: 0 } as Record<ReorderGroup, number>;
    for (const r of inStoreGroup) c[reorderStatus(r, today).state] += 1;
    return c;
  }, [inStoreGroup, today]);
  const inThisGroup = useMemo(
    () => inStoreGroup.filter((r) => reorderStatus(r, today).state === group),
    [inStoreGroup, today, group]
  );

  /** What an empty tile says, within the chosen store group when there is one. */
  const emptyText = storeGroup.within(emptyGroup(group, t));

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

  /** Each store's most recent reason for not ordering, from the last DECLINE_DAYS. */
  const lastDecline = useMemo(() => standingDeclines(declines, rows, zone), [declines, rows, zone]);

  /**
   * "Why no order": the reasons this group's stores gave last, the most first.
   * One store, one reason (its latest), so the bars add up to stores.
   */
  const byReason = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inThisGroup) {
      const d = lastDecline.get(r.store_id);
      if (d) m.set(d.reason, (m.get(d.reason) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inThisGroup, lastDecline]);

  const activePerson = byVisit.some((p) => p.id === person) ? person : "";
  const activeTown = byTown.some(([c]) => c === town) ? town : "";
  const activeReason = byReason.some(([r]) => r === reasonFilter) ? reasonFilter : "";
  const noneMax = Math.max(1, ...byVisit.map((p) => p.n));

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inThisGroup.filter((r) => {
      if (activePerson !== "" && visitLine(visits.get(r.store_id)) !== activePerson) return false;
      if (activeTown !== "" && (r.city?.trim() || "No town recorded") !== activeTown) return false;
      if (activeReason !== "" && lastDecline.get(r.store_id)?.reason !== activeReason) return false;
      if (!q) return true;
      return r.store_name.toLowerCase().includes(q) || (r.city ?? "").toLowerCase().includes(q);
    });
    return sortRows(
      filtered,
      sort,
      today,
      (id) => visits.get(id)?.day ?? null,
      (id) => sales?.get(id) ?? null
    );
  }, [inThisGroup, visits, activePerson, activeTown, activeReason, lastDecline, search, sort, today, sales]);

  /** The rows on screen that nobody is going to: what "Plan these" plans. */
  const unplannedShown = shown.filter((r) => !visits.has(r.store_id));

  function declineText(d: Decline): string {
    // The company's day it was said, not UTC's: late evening in Gaborone is
    // already tomorrow in UTC terms the other way round.
    const day = dayLabel(localDay(zone, new Date(d.created_at)), today);
    return `No order on ${day}: ${DECLINE_REASONS[d.reason as DeclineReason] ?? d.reason}${d.note ? ` ("${d.note}")` : ""}`;
  }

  // Left off until the config has loaded, rather than guessed (as on the dashboard).
  const currency = config?.settings.currency_code ?? "";
  const money = (n: number) => formatMoneyShort(n, currency);

  /** "Tomorrow, Thabo Molefe"; null when nothing is planned (or the plan could not be read: ""). */
  function nextVisitText(r: StoreReorderRow): string | null {
    const v = visits.get(r.store_id);
    if (!v) return visitsFailed ? "" : null;
    const when = v.day === today ? "Today" : v.day === shiftDay(today, 1) ? "Tomorrow" : dayLabel(v.day, today);
    return v.repId ? `${when}, ${nameOf(v.repId)}` : when;
  }

  function buildSheet(): ExportSheet {
    const who =
      activePerson === NONE_PLANNED
        ? `No ${lower(t.job.one)} planned in the next two weeks`
        : activePerson
          ? `Next ${lower(t.job.one)} with ${nameOf(activePerson)}`
          : `Every ${lower(t.site.one)} in "${groupLabel(group)}"`;
    return {
      title: `${t.site.many} due for an order: ${groupLabel(group)}`,
      context: [
        groupMeaning(group, t, rule),
        who,
        ...storeGroup.context,
        ...(activeTown ? [`Town: ${activeTown}`] : []),
        ...(activeReason ? [`Last said: ${DECLINE_REASONS[activeReason as DeclineReason]}`] : []),
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
        ...(sales ? [{ header: "Bought in the last year (excl. VAT)", key: "sales", numeric: true }] : []),
        { header: `Next ${lower(t.job.one)}`, key: "visit" },
        { header: "Phone", key: "phone" },
        { header: "Why no order (last time asked)", key: "why" },
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
          sales: sales?.get(r.store_id) ?? 0,
          visit: nextVisitText(r) ?? "None planned",
          phone: phones.get(r.store_id) ? formatPhone(phones.get(r.store_id)!.phone) : "",
          why: lastDecline.get(r.store_id) ? declineText(lastDecline.get(r.store_id)!) : "",
        };
      }),
    };
  }

  /**
   * The planned visits again, and only those: after planning, nothing else on
   * the page has changed.
   */
  async function refreshVisits() {
    if (!config) return;
    const supabase = createClient();
    const day = localDay(config.timezone);
    const next = await fetchNextVisits(supabase, day, shiftDay(day, NEXT_VISIT_DAYS - 1)).catch(() => null);
    if (!next) return;
    const unknown = [
      ...new Set([...next.values()].map((v) => v.repId).filter((id): id is string => id !== null && !(id in names))),
    ];
    if (unknown.length > 0) {
      const { data } = await supabase.from("profiles").select("id, full_name").in("id", unknown);
      const found = (data ?? []) as { id: string; full_name: string | null }[];
      setNames((n) => ({ ...n, ...Object.fromEntries(found.map((p) => [p.id, p.full_name ?? ""])) }));
    }
    setVisits(next);
    setVisitsFailed(false);
  }

  const total = inStoreGroup.length;
  const tiles: Tile[] = REORDER_TILES.map((g) => ({
    id: g,
    label: groupLabel(g),
    value: counts[g],
    tone: g === "stopped" && counts[g] > 0 ? "bad" : g === "due" && counts[g] > 0 ? "warn" : g === "not_due" ? "good" : undefined,
  }));
  const colSpan = sales ? 6 : 5;
  const canPlan = isManager === true && !!config?.orgId && !visitsFailed;
  const tomorrow = shiftDay(today, 1);

  return (
    <div className="space-y-4">
      <DetailHeader
        title={`${t.site.many} due for an order`}
        subtitle={`When each ${lower(t.site.one)} last ordered, how often it usually orders, and who is due. A ${lower(t.site.one)} is due after ${rule} days without an order, or sooner if it usually orders sooner. Your team sees the same on their phones.`}
        action={<ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />}
      />

      <StoreGroupPicker filter={storeGroup} t={t} ready={!loading && !error} />

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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
            empty={emptyText}
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
            empty={emptyText}
            moreHint="Search the list below to find one."
          />
          <InsightPanel
            title="Why no order"
            caption={`What they said last, ${DECLINE_DAYS} days`}
            lines={byReason.map(([reason, n]) => ({
              id: reason,
              label: DECLINE_REASONS[reason as DeclineReason] ?? reason,
              value: n,
              bar: n / (byReason[0]?.[1] ?? 1),
            }))}
            active={activeReason}
            onToggle={(id) => setReasonFilter(activeReason === id ? "" : id)}
            empty={storeGroup.within(
              `No reasons yet. When a ${lower(t.site.one)} doesn't order, the ${lower(t.staff.one)} picks why on the phone, and it shows here.`
            )}
          />
        </div>
      )}

      <ListTools search={search} onSearch={setSearch} placeholder={`Find a ${lower(t.site.one)} or town`}>
        {activePerson !== "" && (
          <FilterChip onClear={() => setPerson("")}>
            {activePerson === NONE_PLANNED ? `No ${lower(t.job.one)} planned` : `${nameOf(activePerson)}'s next ${lower(t.job.many)}`} · show everyone
          </FilterChip>
        )}
        <StoreGroupChip filter={storeGroup} />
        {activeTown !== "" && <FilterChip onClear={() => setTown("")}>{activeTown} only · every town</FilterChip>}
        {activeReason !== "" && (
          <FilterChip onClear={() => setReasonFilter("")}>
            {DECLINE_REASONS[activeReason as DeclineReason]} · every reason
          </FilterChip>
        )}
        {/* The ones on screen nobody is going to, onto one person's day in one go. */}
        {!loading && canPlan && unplannedShown.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPlanning(unplannedShown.map((r) => ({ id: r.store_id, name: r.store_name })))}
          >
            Plan {lower(t.job.many)} to the {unplannedShown.length} not planned
          </Button>
        )}
      </ListTools>

      {planned && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {planned}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label={t.site.one} sortKey="name" sort={sort} onSort={chooseSort} />
              <SortHead label="Last order" sortKey="last" sort={sort} onSort={chooseSort} />
              <SortHead label="Usually orders" sortKey="usual" sort={sort} onSort={chooseSort} className="hidden md:table-cell" />
              <SortHead label="Orders in a year" sortKey="orders" sort={sort} onSort={chooseSort} className="hidden text-right lg:table-cell" />
              {sales && (
                <SortHead label="Bought in a year" sortKey="sales" sort={sort} onSort={chooseSort} className="hidden text-right xl:table-cell" />
              )}
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
                    emptyText
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
                          setReasonFilter("");
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
                const phone = phones.get(r.store_id);
                const declined = lastDecline.get(r.store_id);
                return (
                  <TableRow key={r.store_id}>
                    <TableCell className="min-w-[140px] whitespace-normal text-sm sm:min-w-[200px]">
                      <Link href={storeHref(r.store_id)} className="font-medium text-primary hover:underline">
                        {r.store_name}
                      </Link>
                      {r.city && <span className="block text-xs text-muted-foreground">{r.city}</span>}
                      {phone && (
                        <a href={`tel:${phone.phone}`} className="block text-xs text-primary hover:underline" title={phone.name}>
                          {formatPhone(phone.phone)}
                        </a>
                      )}
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
                    <TableCell className="whitespace-nowrap text-sm" title={r.last_order_on ? dayLabel(r.last_order_on, today) : undefined}>
                      <span className="font-medium tabular-nums text-foreground">{describeDays(s.daysSince)}</span>
                      {r.last_order_on && (
                        <span className="block text-xs text-muted-foreground">
                          {dayLabel(r.last_order_on, today)} · {orderLabel(r)}
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
                      {declined && (
                        <span className="block max-w-[280px] whitespace-normal text-xs italic text-muted-foreground">
                          {declineText(declined)}
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
                    {sales && (
                      <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground xl:table-cell">
                        {sales.get(r.store_id) ? money(sales.get(r.store_id)!) : "Nothing"}
                      </TableCell>
                    )}
                    <TableCell className="hidden text-sm sm:table-cell">
                      {visit === null ? (
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="italic text-amber-700 dark:text-amber-400">None planned</span>
                          {canPlan && (
                            <button
                              type="button"
                              className="text-xs font-medium text-primary hover:underline"
                              onClick={() => setPlanning([{ id: r.store_id, name: r.store_name }])}
                            >
                              Plan one
                            </button>
                          )}
                        </span>
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
          An order is any order that was not cancelled, and the invoices brought over from QuickBooks. An order
          counts from the day it was invoiced in QuickBooks or confirmed, if that was later than the day it was
          taken. How often a{" "}
          {lower(t.site.one)} usually orders needs three orders in the last year. Next {lower(t.job.one)} looks{" "}
          {NEXT_VISIT_DAYS} days ahead.{sales ? " Bought in a year is what was invoiced, excluding VAT." : ""}
          {salesFailed
            ? ` What each ${lower(t.site.one)} bought could not be read, so the ones that stopped ordering are in order of how often they ordered.`
            : ""} Phone numbers come
          from each {lower(t.site.one)}&apos;s contacts on the {t.site.many} page.
        </p>
      )}

      {config?.orgId && (
        <PlanVisitsDialog
          orgId={config.orgId}
          stores={planning}
          open={planning.length > 0}
          onOpenChange={(open) => {
            if (!open) setPlanning([]);
          }}
          tomorrow={tomorrow}
          lastDay={shiftDay(today, NEXT_VISIT_DAYS - 1)}
          onPlanned={(added, already, day, who) => {
            setPlanned(
              `${count(t, "job", added)} planned for ${who || "them"} on ${dayLabel(day, today)}.` +
                (already > 0 ? ` ${count(t, "site", already)} ${already === 1 ? "was" : "were"} already on that day.` : "")
            );
            void refreshVisits();
          }}
        />
      )}
    </div>
  );
}
