"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExportMenu } from "@/components/export-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DetailHeader,
  FilterChip,
  InsightPanel,
  ListTools,
  LookBackPicker,
  SortHead,
  TilePicker,
  TopCard,
  type SortState,
  type Tile,
} from "@/components/dashboard/detail-page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StoreGroupChip, StoreGroupPicker } from "@/components/dashboard/store-group-picker";
import { PlanVisitsDialog } from "@/components/stores/plan-visits-dialog";
import { NotForThisStoreDialog } from "@/components/stores/not-for-this-store-dialog";
import {
  RANGE_DAYS,
  rangeShowFromQuery,
  rangeStoreFromQuery,
  storeHref,
  storeReorderHref,
  type LookBack,
  type RangeShow,
} from "@/lib/dashboard-links";
import { localDay } from "@/lib/dashboard-numbers";
import { shiftDay } from "@/lib/dashboard";
import type { ExportSheet } from "@/lib/export";
import { formatMoneyShort } from "@/lib/money";
import { can } from "@/lib/permissions";
import { fetchAssignments, type Assignment } from "@/lib/representatives";
import { callRpc } from "@/lib/rpc";
import { NO_STORE_GROUP } from "@/lib/store-groups";
import {
  callLabel,
  DEFAULT_RANGE_DAYS,
  fetchRangeCatalogue,
  fetchRangeProducts,
  fetchRangeStatus,
  newProductsLine,
  productCalls,
  reasonWords,
  resultLabel,
  resultTone,
  resultWords,
  shortNames,
  showLabel,
  sizeLabel,
  sizeWhy,
  statusLabel,
  summariseNewProducts,
  summariseRange,
  type RangeLine,
  type RangeProduct,
  type RangeProductRow,
  type RangeStatus,
  type RangeStoreRow,
} from "@/lib/store-range";
import { daysBetween, dayLabel, NEXT_VISIT_DAYS } from "@/lib/store-reorder";
import { createClient } from "@/lib/supabase/client";
import { count, lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { useIsManager } from "@/lib/use-is-manager";
import { usePermissions } from "@/lib/use-permissions";
import { useStoreGroupFilter } from "@/lib/use-store-group-filter";

/** "" is everyone; this is the "By rep" line for stores nobody is assigned to. */
const UNASSIGNED = "unassigned";

/** The tiles, in the order a manager acts on them. */
const SHOWS: readonly RangeShow[] = ["missing", "stopped", "products", "new"];

/** A store tile's status: missing is never ordered, stopped is ordered before and not lately. */
const STATUS_OF: Record<"missing" | "stopped", RangeStatus> = { missing: "gap", stopped: "stopped" };

/** The order new products are listed in: the results that need a decision first. */
const RESULT_ORDER = ["proven", "not_taking", "slow", "untried", "trying", "waiting"] as const;

type StoreSortKey = "name" | "count" | "value";
type ProductSortKey = "name" | "spread" | "ros" | "gaps" | "value";

const TONE_CHIP: Record<"gap" | "stopped", string> = {
  gap: "bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/25",
  stopped: "bg-red-50 text-red-900 ring-red-600/20 dark:bg-red-400/10 dark:text-red-200 dark:ring-red-400/25",
};

const STATUS_TEXT: Record<RangeStatus, string> = {
  have: "text-emerald-700 dark:text-emerald-400",
  gap: "text-amber-700 dark:text-amber-400",
  stopped: "text-red-700 dark:text-red-400",
  quiet: "text-muted-foreground",
  off_range: "text-muted-foreground",
};

/**
 * The Range card, opened up (owner, 19 Oct 2026): which products each store
 * should carry, worked out by Tickd from the orders, and where they are
 * missing. The tiles choose the view: stores missing products, stores that
 * stopped buying one, every product with what to do about it, and the new
 * products' results. Each missing product says why it belongs (similar stores
 * take it, the store's own orders, a proven new product, or the office's
 * override) and what similar stores sell of it a month.
 *
 * `?show=` opens a tile, `?group=` one store group (useStoreGroupFilter),
 * `?store=` one store with its whole range. The rows come from range_status
 * and range_products, the functions the dashboard card counts.
 */
export default function StoreRangePage() {
  const t = useTerms();
  const config = useCompanyConfig();
  const permissions = usePermissions();
  const isManager = useIsManager();
  const currency = config?.settings.currency_code ?? "";
  const money = (n: number) => formatMoneyShort(n, currency);
  const canExclude = permissions !== null && can(permissions, "sales_coverage");
  const site = lower(t.site.one);
  const sites = lower(t.site.many);

  const zone = config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDay(zone);
  const lapse = config?.settings.range_lapse_days ?? DEFAULT_RANGE_DAYS;

  const [rows, setRows] = useState<RangeStoreRow[]>([]);
  const [products, setProducts] = useState<RangeProductRow[]>([]);
  const [catalogue, setCatalogue] = useState<RangeProduct[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loadingRows, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [urlRead, setUrlRead] = useState(false);

  const [asked, setAsked] = useState<RangeShow | null>(null);
  /** One store, from `?store=` or a row's "Only this one". */
  const [onlyStore, setOnlyStore] = useState<string | null>(null);
  /** The look-back the page chose; null is the company's own (range_lapse_days). */
  const [win, setWin] = useState<LookBack | null>(null);
  const [product, setProduct] = useState("");
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [storeSort, setStoreSort] = useState<SortState<StoreSortKey> | null>(null);
  const [productSort, setProductSort] = useState<SortState<ProductSortKey>>({ key: "value", dir: "desc" });
  const [excluding, setExcluding] = useState<{
    storeId: string;
    storeName: string;
    products: { id: string; name: string }[];
  } | null>(null);
  const [planning, setPlanning] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const days =
    win === null ? lapse : "days" in win ? win.days : Math.min(365, Math.max(7, daysBetween(win.since, today) + 1));
  const winValue: LookBack = win ?? { days: lapse };
  const askedKey = win === null ? "company" : String(days);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only: the tiles own the tile and the picker the look-back from here.
    const q = new URLSearchParams(window.location.search);
    setAsked(rangeShowFromQuery(q));
    setOnlyStore(rangeStoreFromQuery(q));
    const d = Number(q.get("days"));
    if ((RANGE_DAYS as readonly number[]).includes(d)) setWin({ days: d });
    setUrlRead(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Who covers each store, and their names: read once.
  useEffect(() => {
    let stale = false;
    const supabase = createClient();
    fetchAssignments(supabase)
      .catch(() => [] as Assignment[])
      .then(async (assigned) => {
        const ids = [...new Set(assigned.map((a) => a.rep_id))];
        const { data } =
          ids.length === 0 ? { data: [] } : await supabase.from("profiles").select("id, full_name").in("id", ids);
        if (stale) return;
        setAssignments(assigned);
        setNames(
          Object.fromEntries(
            ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? ""]),
          ),
        );
      });
    return () => {
      stale = true;
    };
  }, [attempt]);

  // The ranges and the products, again whenever the look-back changes.
  useEffect(() => {
    if (!urlRead) return;
    let stale = false;
    const supabase = createClient();
    const asked = win === null ? null : days;
    Promise.all([fetchRangeStatus(supabase, asked), fetchRangeProducts(supabase), fetchRangeCatalogue(supabase)])
      .then(([r, p, c]) => {
        if (stale) return;
        setRows(r);
        setProducts(p);
        setCatalogue(c);
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
    // `win` is read through `askedKey`, which changes exactly when the
    // question does: not when the company's own look-back arrives with the
    // config (null asks for it either way).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlRead, askedKey, attempt]);

  function chooseWindow(next: LookBack) {
    const nextDays = "days" in next ? next.days : Math.min(365, Math.max(7, daysBetween(next.since, today) + 1));
    if (nextDays === days) return;
    setLoading(true);
    setWin(next);
    const url = new URL(window.location.href);
    url.searchParams.delete("days");
    if ("days" in next && next.days !== lapse) url.searchParams.set("days", String(next.days));
    window.history.replaceState(null, "", url);
  }

  const show: RangeShow = asked ?? "missing";
  function chooseShow(next: RangeShow) {
    setAsked(next);
    setProduct("");
    setPerson("");
    setStoreSort(null);
    const url = new URL(window.location.href);
    url.searchParams.set("show", next);
    window.history.replaceState(null, "", url);
  }
  function clearStore() {
    setOnlyStore(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("store");
    window.history.replaceState(null, "", url);
  }

  function retry() {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }

  const names_ = useMemo(() => shortNames(catalogue), [catalogue]);
  const productName = (id: string) => names_.get(id) ?? "A product no longer listed";
  const fullName = useMemo(() => new Map(catalogue.map((p) => [p.id, p])), [catalogue]);
  const nameOf = (id: string) => names[id] || `Unnamed ${lower(t.staff.one)}`;

  /** Each store's people, the main one first. */
  const peopleOf = useMemo(() => {
    const m = new Map<string, string[]>();
    const ordered = [...assignments].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    for (const a of ordered) m.set(a.store_id, [...(m.get(a.store_id) ?? []), a.rep_id]);
    return m;
  }, [assignments]);

  const storeGroup = useStoreGroupFilter(rows, t, {
    key: "store_id",
    onChoose: () => {
      setProduct("");
      setPerson("");
    },
  });
  const inGroup = storeGroup.rows;
  const loading = loadingRows || storeGroup.loading;
  const groupName = (id: string | null) =>
    id === null || id === NO_STORE_GROUP
      ? `No ${lower(t.site_group.one)}`
      : (storeGroup.choices.find((c) => c.id === id)?.name ?? lower(t.site_group.one));

  const summary = useMemo(() => summariseRange(inGroup), [inGroup]);
  const newSummary = useMemo(() => summariseNewProducts(products), [products]);
  const seesMoney = summary.missingValue !== null;

  // ------------------------------------------------------------- store views

  const status: RangeStatus | null = show === "missing" || show === "stopped" ? STATUS_OF[show] : null;
  /** The lines this tile is about, per store (a store's whole range when one store is chosen). */
  const linesOf = (r: RangeStoreRow): RangeLine[] =>
    status === null ? [] : r.lines.filter((l) => l.status === status && (product === "" || l.product_id === product));

  const storeRows = useMemo(() => {
    if (status === null) return [];
    return inGroup.filter((r) =>
      onlyStore ? r.store_id === onlyStore : !r.quiet && r.lines.some((l) => l.status === status),
    );
  }, [inGroup, status, onlyStore]);

  const byProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of storeRows)
      for (const l of r.lines) if (l.status === status) m.set(l.product_id, (m.get(l.product_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [storeRows, status]);

  const byPerson = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of storeRows) {
      const n = linesOf(r).length;
      if (n === 0) continue;
      const ids = peopleOf.get(r.store_id) ?? [];
      if (ids.length === 0) m.set(UNASSIGNED, { name: "Unassigned", n: (m.get(UNASSIGNED)?.n ?? 0) + n });
      for (const id of ids) m.set(id, { name: nameOf(id), n: (m.get(id)?.n ?? 0) + n });
    }
    return [...m.entries()].sort(
      (a, b) => Number(a[0] === UNASSIGNED) - Number(b[0] === UNASSIGNED) || b[1].n - a[1].n,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeRows, peopleOf, names, product]);

  const activeProduct = byProduct.some(([id]) => id === product) ? product : "";
  const activePerson = byPerson.some(([id]) => id === person) ? person : "";

  const sortStores: SortState<StoreSortKey> = storeSort ?? { key: seesMoney ? "value" : "count", dir: "desc" };
  const valueOf = (r: RangeStoreRow) => linesOf(r).reduce((s, l) => s + (l.est_value_month ?? 0), 0);

  const shownStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = storeRows.filter((r) => {
      if (!onlyStore && linesOf(r).length === 0) return false;
      const ids = peopleOf.get(r.store_id) ?? [];
      if (activePerson === UNASSIGNED && ids.length > 0) return false;
      if (activePerson !== "" && activePerson !== UNASSIGNED && !ids.includes(activePerson)) return false;
      if (!q) return true;
      return r.store_name.toLowerCase().includes(q) || (r.city ?? "").toLowerCase().includes(q);
    });
    const sign = sortStores.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const x =
        sortStores.key === "name"
          ? a.store_name.toLowerCase()
          : sortStores.key === "count"
            ? linesOf(a).length
            : valueOf(a);
      const y =
        sortStores.key === "name"
          ? b.store_name.toLowerCase()
          : sortStores.key === "count"
            ? linesOf(b).length
            : valueOf(b);
      if (x === y) return a.store_name.localeCompare(b.store_name);
      return sign * (x < y ? -1 : 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeRows, search, activePerson, peopleOf, sortStores.key, sortStores.dir, product, onlyStore]);

  function toggleRow(id: string) {
    setOpenRows((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ----------------------------------------------------------- product views

  /** Per product, over the chosen group's stores: in range, has it, missing, stopped, ordered outside. */
  const productSpread = useMemo(() => {
    const m = new Map<
      string,
      { inRange: number; have: number; gaps: number; stopped: number; off: number; value: number }
    >();
    for (const r of inGroup) {
      for (const l of r.lines) {
        const cur = m.get(l.product_id) ?? { inRange: 0, have: 0, gaps: 0, stopped: 0, off: 0, value: 0 };
        if (l.in_range && l.status !== "quiet") cur.inRange += 1;
        if (l.status === "have") cur.have += 1;
        if (l.status === "gap") cur.gaps += 1;
        if (l.status === "stopped") cur.stopped += 1;
        if (l.status === "off_range") cur.off += 1;
        if (l.status === "gap" || l.status === "stopped") cur.value += l.est_value_month ?? 0;
        m.set(l.product_id, cur);
      }
    }
    return m;
  }, [inGroup]);
  const calls = useMemo(() => productCalls(products, (id) => productSpread.get(id)), [products, productSpread]);

  const shownProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => !q || (fullName.get(p.product_id)?.name ?? "").toLowerCase().includes(q));
    const spreadOf = (p: RangeProductRow) => {
      const s = productSpread.get(p.product_id);
      return s && s.inRange > 0 ? s.have / s.inRange : -1;
    };
    const val = (p: RangeProductRow): number | string => {
      switch (productSort.key) {
        case "name":
          return productName(p.product_id).toLowerCase();
        case "spread":
          return spreadOf(p);
        case "ros":
          return p.ros ?? -1;
        case "gaps":
          return (productSpread.get(p.product_id)?.gaps ?? 0) + (productSpread.get(p.product_id)?.stopped ?? 0);
        case "value":
          return seesMoney
            ? (productSpread.get(p.product_id)?.value ?? 0)
            : (productSpread.get(p.product_id)?.gaps ?? 0);
      }
    };
    const sign = productSort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return productName(a.product_id).localeCompare(productName(b.product_id));
      return sign * (x < y ? -1 : 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, productSpread, search, productSort.key, productSort.dir, names_, seesMoney]);

  const newProducts = useMemo(
    () =>
      products
        .filter((p) => p.stage !== "established")
        .filter(
          (p) =>
            !search.trim() ||
            (fullName.get(p.product_id)?.name ?? "").toLowerCase().includes(search.trim().toLowerCase()),
        )
        .sort(
          (a, b) =>
            RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result) ||
            b.tried - a.tried ||
            productName(a.product_id).localeCompare(productName(b.product_id)),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, search, names_],
  );

  // ------------------------------------------------------------------ actions

  async function include(storeId: string, productId: string) {
    const { error: e } = await callRpc(createClient(), "store_range_include", {
      p_store_id: storeId,
      p_product_ids: [productId],
    });
    if (e) {
      setNotice(`Could not undo it: ${e.message}`);
      return;
    }
    setNotice(`${productName(productId)} is back in the range for that ${site}.`);
    setAttempt((n) => n + 1);
  }

  // -------------------------------------------------------------------- export

  function buildSheet(): ExportSheet {
    const context = [
      `In the last ${days} days`,
      ...(activePerson
        ? [activePerson === UNASSIGNED ? "Unassigned only" : `${t.staff.one}: ${nameOf(activePerson)}`]
        : []),
      ...storeGroup.context,
      ...(activeProduct ? [`Product: ${productName(activeProduct)}`] : []),
      ...(search.trim() ? [`Matching "${search.trim()}"`] : []),
    ];
    if (status !== null) {
      return {
        title: `Range: ${showLabel(show, t.site.many)}`,
        context: [meaning(), ...context],
        filename: `range-${show}`,
        columns: [
          { header: t.site.one, key: "site" },
          { header: "Town", key: "town" },
          { header: t.site_group.one, key: "group" },
          { header: "Size", key: "size" },
          { header: "Responsible", key: "people" },
          { header: "Product", key: "product" },
          { header: "Why it is in their range", key: "why" },
          { header: "Last ordered", key: "last" },
          { header: `Similar ${sites} sell a month (boxes)`, key: "boxes", numeric: true },
          ...(seesMoney ? [{ header: "About a month", key: "value", numeric: true }] : []),
        ],
        rows: shownStores.flatMap((r) =>
          linesOf(r).map((l) => ({
            site: r.store_name,
            town: r.city ?? "",
            group: groupName(r.store_group_id),
            size: sizeLabel(r.size),
            people: (peopleOf.get(r.store_id) ?? []).map(nameOf).join(", "),
            product: fullName.get(l.product_id)?.name ?? productName(l.product_id),
            why: reasonWords(
              l,
              r,
              r.store_group_id ? groupName(r.store_group_id) : null,
              t.site.one,
              t.site.many,
              `with no ${lower(t.site_group.one)}`,
            ),
            last: l.last_ordered ? dayLabel(l.last_ordered, today) : "Never",
            boxes: l.est_boxes_month ?? "",
            value: l.est_value_month ?? "",
          })),
        ),
      };
    }
    if (show === "new") {
      return {
        title: "Range: new products",
        context: [meaning(), ...context],
        filename: "range-new-products",
        columns: [
          { header: "Product", key: "product" },
          { header: "Result", key: "result" },
          { header: "What it means", key: "why" },
          { header: `${t.site.many} that ordered it`, key: "tried", numeric: true },
          { header: "Ordered it again", key: "repeats", numeric: true },
          { header: `Boxes per ${site} a month`, key: "ros", numeric: true },
          { header: "Similar products", key: "similar", numeric: true },
        ],
        rows: newProducts.map((p) => ({
          product: fullName.get(p.product_id)?.name ?? "",
          result: resultLabel(p.result),
          why: resultWords(p, groupName, t.site.one, t.site.many),
          tried: p.tried,
          repeats: p.repeats,
          ros: p.ros ?? "",
          similar: p.similar_ros ?? "",
        })),
      };
    }
    return {
      title: "Range: every product",
      context: [meaning(), ...context],
      filename: "range-products",
      columns: [
        { header: "Product", key: "product" },
        { header: "What to do", key: "call" },
        { header: `${t.site.many} whose range has it`, key: "inRange", numeric: true },
        { header: "Have it", key: "have", numeric: true },
        { header: "Missing or stopped", key: "gaps", numeric: true },
        { header: `Boxes per ${site} a month`, key: "ros", numeric: true },
        ...(seesMoney ? [{ header: "Missing sells about a month", key: "value", numeric: true }] : []),
      ],
      rows: shownProducts.map((p) => {
        const s = productSpread.get(p.product_id);
        return {
          product: fullName.get(p.product_id)?.name ?? "",
          call: callLabel(calls.get(p.product_id) ?? "none", t.site.many),
          inRange: s?.inRange ?? 0,
          have: s?.have ?? 0,
          gaps: (s?.gaps ?? 0) + (s?.stopped ?? 0),
          ros: p.ros ?? "",
          value: s ? Math.round(s.value) : "",
        };
      }),
    };
  }

  // --------------------------------------------------------------------- words

  function meaning(): string {
    switch (show) {
      case "missing":
        return `Products these ${sites} should have and have never ordered. Similar ${sites} sell them, or Tickd added a proven new product. Show them to the buyer on the next ${lower(t.job.one)}.`;
      case "stopped":
        return `Products these ${sites} used to order and have not in ${days} days, while they still order other things. Ask why: a competitor often takes the shelf space.`;
      case "products":
        return `Each product: how many ${sites} that should have it do, how fast it sells where it is, and what to do about it.`;
      case "new":
        return `Tickd judges each new product by whether ${sites} order it again. A proven one goes into your big ${sites} by itself.`;
    }
  }

  const tiles: Tile[] = SHOWS.map((s) => {
    switch (s) {
      case "missing":
        return {
          id: s,
          label: showLabel(s, t.site.many),
          value: summary.missing,
          tone: summary.missing > 0 ? "warn" : undefined,
          sub:
            seesMoney && summary.missingValue
              ? `about ${money(summary.missingValue)} a month`
              : `in ${count(t, "site", summary.storesMissing)}`,
        };
      case "stopped":
        return {
          id: s,
          label: showLabel(s, t.site.many),
          value: summary.stopped,
          tone: summary.stopped > 0 ? "bad" : undefined,
          sub: `in ${count(t, "site", summary.storesStopped)}`,
        };
      case "products":
        return {
          id: s,
          label: showLabel(s, t.site.many),
          value: products.length,
          sub: `${summary.filledPct ?? 0}% of ranges filled`,
        };
      case "new": {
        const n = products.filter((p) => p.stage !== "established").length;
        return {
          id: s,
          label: showLabel(s, t.site.many),
          value: n,
          sub: newSummary.proven > 0 ? `${newSummary.proven} proven` : undefined,
        };
      }
    }
  });

  const onlyRow = onlyStore ? rows.find((r) => r.store_id === onlyStore) : undefined;
  const total = Math.max(1, summary.inRange);
  const tomorrow = shiftDay(today, 1);
  const canPlan = isManager === true && !!config?.orgId && status !== null && shownStores.length > 0;

  return (
    <div className="space-y-4">
      <DetailHeader
        title="Range"
        subtitle={`Which products each ${site} should have, and where they are missing. Tickd works it out from your orders and keeps learning as they come in.`}
        action={<ExportMenu build={buildSheet} disabled={loading || !!error} />}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <LookBackPicker value={winValue} onChange={chooseWindow} presets={RANGE_DAYS} today={today} />
        <StoreGroupPicker filter={storeGroup} t={t} ready={!loading && !error} />
      </div>

      <TopCard>
        {summary.learning && !loading ? (
          <p className="text-sm text-foreground">
            Tickd is learning your {sites}: {Math.min(summary.orderingStores, summary.minStores)} of {summary.minStores}{" "}
            have ordered. Once {summary.minStores} have, you will see which products each {site} should have. New
            products are judged already.
          </p>
        ) : (
          summary.inRange > 0 && (
            <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              <div className="bg-emerald-600" style={{ flex: summary.have / total }} />
              <div className="bg-amber-500" style={{ flex: summary.missing / total }} />
              <div className="bg-red-600" style={{ flex: summary.stopped / total }} />
            </div>
          )
        )}
        <TilePicker
          tiles={tiles}
          active={show}
          onChoose={(id) => id && chooseShow(id as RangeShow)}
          label="What to show"
          loading={loading}
        />
        <p className="text-sm text-foreground">{meaning()}</p>
        {storeGroup.active !== "" && (show === "products" || show === "new") && (
          <p className="text-xs text-muted-foreground">
            The {lower(t.site.many)} counts are for {groupName(storeGroup.active)}. A product&rsquo;s result and how
            fast it sells count every {lower(t.site_group.one)}, because a new product is judged on all its orders.
          </p>
        )}
      </TopCard>

      {status !== null && !loading && !error && !onlyStore && byProduct.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <InsightPanel
            title="By product"
            caption={showLabel(show, t.site.many)}
            lines={byProduct.map(([id, n]) => ({
              id,
              label: productName(id),
              value: n,
              bar: n / (byProduct[0]?.[1] ?? 1),
            }))}
            active={activeProduct}
            onToggle={(id) => setProduct(activeProduct === id ? "" : id)}
            limit={10}
            empty="Nothing here."
            footnote={`How many ${sites} each product is ${show === "missing" ? "missing from" : "no longer ordered by"}. Tap one to see only its ${sites}.`}
          />
          <InsightPanel
            title={`By ${lower(t.staff.one)}`}
            caption={showLabel(show, t.site.many)}
            lines={byPerson.map(([id, p]) => ({
              id,
              label: p.name,
              value: p.n,
              bar: p.n / Math.max(1, ...byPerson.map(([, q]) => q.n)),
              aside: id === UNASSIGNED ? "warn" : undefined,
            }))}
            active={activePerson}
            onToggle={(id) => setPerson(activePerson === id ? "" : id)}
            limit={12}
            empty="Nothing here."
            footnote={`Tap a name to see only their ${sites}, then Export it for them or plan their ${lower(t.job.many)}.`}
          />
        </div>
      )}

      <ListTools
        search={search}
        onSearch={setSearch}
        placeholder={status !== null ? `Find a ${site} or town` : "Find a product"}
      >
        {onlyStore && (
          <FilterChip onClear={clearStore}>
            {onlyRow?.store_name ?? `One ${site}`} only · every {site}
          </FilterChip>
        )}
        {activeProduct !== "" && (
          <FilterChip onClear={() => setProduct("")}>{productName(activeProduct)} only · every product</FilterChip>
        )}
        {activePerson !== "" && (
          <FilterChip onClear={() => setPerson("")}>
            {activePerson === UNASSIGNED ? "Unassigned only" : `${nameOf(activePerson)} only`} · show everyone
          </FilterChip>
        )}
        <StoreGroupChip filter={storeGroup} />
      </ListTools>

      {canPlan && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPlanning(shownStores.map((r) => ({ id: r.store_id, name: r.store_name })))}
          >
            Plan {lower(t.job.many)} to the {count(t, "site", shownStores.length)} shown
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-foreground">
          {notice}
        </p>
      )}

      {status !== null ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead
                  label={t.site.one}
                  sortKey="name"
                  sort={sortStores}
                  onSort={(k) => setStoreSort(flip(sortStores, k))}
                />
                <TableHead className="hidden md:table-cell">In range</TableHead>
                <SortHead
                  label={showLabel(show, t.site.many)}
                  sortKey="count"
                  sort={sortStores}
                  onSort={(k) => setStoreSort(flip(sortStores, k))}
                  className="hidden sm:table-cell"
                />
                {seesMoney && (
                  <SortHead
                    label="About a month"
                    sortKey="value"
                    sort={sortStores}
                    onSort={(k) => setStoreSort(flip(sortStores, k))}
                    className="hidden text-right sm:table-cell"
                  />
                )}
                <TableHead className="w-0">
                  <span className="sr-only">Why</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <MessageRow cols={5}>Loading {sites}…</MessageRow>
              ) : error ? (
                <MessageRow cols={5}>
                  <p className="font-medium text-destructive">Could not load the range</p>
                  <p className="mt-1 text-muted-foreground">{error}</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={retry}>
                    Try again
                  </Button>
                </MessageRow>
              ) : shownStores.length === 0 ? (
                <MessageRow cols={5}>
                  {storeRows.length === 0
                    ? storeGroup.within(
                        summary.learning
                          ? `Tickd will show this once ${summary.minStores} ${sites} have ordered.`
                          : show === "missing"
                            ? `Every ${site} that has ordered lately has its whole range.`
                            : `No ${site} has stopped buying a product in its range.`,
                      )
                    : `No ${sites} match.`}
                </MessageRow>
              ) : (
                shownStores.map((r) => {
                  const lines = linesOf(r).sort((a, b) => (b.est_value_month ?? 0) - (a.est_value_month ?? 0));
                  const inRange = r.lines.filter((l) => l.in_range && l.status !== "quiet");
                  const has = inRange.filter((l) => l.status === "have").length;
                  const people = (peopleOf.get(r.store_id) ?? []).map(nameOf).join(", ");
                  const open = openRows.has(r.store_id) || onlyStore === r.store_id;
                  const value = lines.reduce((s, l) => s + (l.est_value_month ?? 0), 0);
                  return (
                    <Fragment key={r.store_id}>
                      <TableRow>
                        <TableCell className="min-w-[150px] whitespace-normal align-top text-sm sm:min-w-[200px]">
                          <Link href={storeHref(r.store_id)} className="font-medium text-primary hover:underline">
                            {r.store_name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {[r.city, groupName(r.store_group_id), `${sizeLabel(r.size)} ${site}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="block text-xs text-muted-foreground">{people || "Unassigned"}</span>
                          <span className="block text-xs text-muted-foreground md:hidden">
                            Has {has} of {inRange.length} in its range
                          </span>
                          {/* Below sm the chips ride under the name, so the list fits a phone. */}
                          <div className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">
                            {lines.length === 0 ? (
                              <span className="text-sm text-muted-foreground">
                                {r.quiet ? "Has not ordered lately" : "Nothing missing"}
                              </span>
                            ) : (
                              lines.map((l) => (
                                <span
                                  key={l.product_id}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                    TONE_CHIP[l.status === "stopped" ? "stopped" : "gap"]
                                  }`}
                                >
                                  {productName(l.product_id)}
                                  {l.est_value_month ? (
                                    <span className="font-normal opacity-80">· {money(l.est_value_month)}</span>
                                  ) : null}
                                </span>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden align-top text-sm tabular-nums text-muted-foreground md:table-cell">
                          {has} of {inRange.length}
                        </TableCell>
                        <TableCell className="hidden whitespace-normal align-top sm:table-cell">
                          <div className="flex flex-wrap gap-1.5">
                            {lines.length === 0 ? (
                              <span className="text-sm text-muted-foreground">
                                {r.quiet ? "Has not ordered lately" : "Nothing missing"}
                              </span>
                            ) : (
                              lines.map((l) => (
                                <span
                                  key={l.product_id}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                    TONE_CHIP[l.status === "stopped" ? "stopped" : "gap"]
                                  }`}
                                >
                                  {productName(l.product_id)}
                                  {l.est_value_month ? (
                                    <span className="font-normal opacity-80">· {money(l.est_value_month)}</span>
                                  ) : null}
                                </span>
                              ))
                            )}
                          </div>
                        </TableCell>
                        {seesMoney && (
                          <TableCell className="hidden whitespace-nowrap text-right align-top text-sm font-medium tabular-nums sm:table-cell">
                            {value > 0 ? money(value) : ""}
                          </TableCell>
                        )}
                        <TableCell className="align-top">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={open}
                            aria-controls={`why-${r.store_id}`}
                            onClick={() => toggleRow(r.store_id)}
                            disabled={onlyStore === r.store_id}
                          >
                            {open ? "Hide" : "Why"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow id={`why-${r.store_id}`} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={5} className="whitespace-normal py-3">
                            <StoreRange
                              row={r}
                              lines={onlyStore === r.store_id ? r.lines : lines}
                              groupLabel={r.store_group_id ? groupName(r.store_group_id) : null}
                              siteWord={t.site.one}
                              sitesWord={t.site.many}
                              noGroup={`with no ${lower(t.site_group.one)}`}
                              productName={productName}
                              money={seesMoney ? money : null}
                              today={today}
                              canExclude={canExclude}
                              onExclude={(ids) =>
                                setExcluding({
                                  storeId: r.store_id,
                                  storeName: r.store_name,
                                  products: ids.map((id) => ({ id, name: productName(id) })),
                                })
                              }
                              onInclude={(id) => void include(r.store_id, id)}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      ) : show === "products" ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead
                  label="Product"
                  sortKey="name"
                  sort={productSort}
                  onSort={(k) => setProductSort(flip(productSort, k))}
                />
                <SortHead
                  label="Have it"
                  sortKey="spread"
                  sort={productSort}
                  onSort={(k) => setProductSort(flip(productSort, k))}
                  className="text-right"
                />
                <SortHead
                  label={`Boxes per ${site} a month`}
                  sortKey="ros"
                  sort={productSort}
                  onSort={(k) => setProductSort(flip(productSort, k))}
                  className="hidden text-right sm:table-cell"
                />
                <SortHead
                  label={seesMoney ? "Missing sells a month" : "Missing"}
                  sortKey="value"
                  sort={productSort}
                  onSort={(k) => setProductSort(flip(productSort, k))}
                  className="hidden text-right md:table-cell"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <MessageRow cols={4}>Loading products…</MessageRow>
              ) : error ? (
                <MessageRow cols={4}>
                  <p className="font-medium text-destructive">Could not load the products</p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={retry}>
                    Try again
                  </Button>
                </MessageRow>
              ) : shownProducts.length === 0 ? (
                <MessageRow cols={4}>
                  {products.length === 0 ? "Add products to see them here." : "No products match."}
                </MessageRow>
              ) : (
                shownProducts.map((p) => {
                  const s = productSpread.get(p.product_id);
                  const c = calls.get(p.product_id) ?? "none";
                  return (
                    <TableRow key={p.product_id}>
                      <TableCell className="min-w-[160px] whitespace-normal text-sm">
                        <span className="font-medium text-foreground">{productName(p.product_id)}</span>
                        <span
                          className={`block text-xs ${c === "push" ? "font-medium text-primary" : c === "big_only" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          {callLabel(c, t.site.many)}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                        {s && s.inRange > 0 ? (
                          <>
                            {s.have} of {s.inRange}
                            <span className="block text-xs text-muted-foreground">
                              {Math.round((100 * s.have) / s.inRange)}%
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">In no range</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground sm:table-cell">
                        {p.ros !== null ? p.ros.toFixed(1) : ""}
                      </TableCell>
                      <TableCell className="hidden text-right text-sm tabular-nums md:table-cell">
                        {seesMoney ? (s && s.value > 0 ? money(s.value) : "") : (s?.gaps ?? 0) + (s?.stopped ?? 0)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="space-y-2">
          {loading ? (
            <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              Loading products…
            </p>
          ) : error ? (
            <div className="rounded-lg border border-border bg-card py-10 text-center text-sm">
              <p className="font-medium text-destructive">Could not load the products</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : newProducts.length === 0 ? (
            <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No new products. When you add one, Tickd follows its first orders and tells you how it is doing.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{newProductsLine(newSummary)}.</p>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {newProducts.map((p) => {
                  const tone = resultTone(p.result);
                  return (
                    <li
                      key={p.product_id}
                      className="flex flex-col gap-1 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{productName(p.product_id)}</p>
                        <p className="text-sm text-muted-foreground">
                          {resultWords(p, groupName, t.site.one, t.site.many)}
                        </p>
                        {p.ros !== null && p.similar_ros !== null && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {p.ros.toFixed(1)} boxes per {site} a month, against {p.similar_ros.toFixed(1)} for similar
                            products.
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 self-start ${
                          tone === "good"
                            ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400"
                            : tone === "bad"
                              ? "border-red-600/30 text-red-700 dark:text-red-400"
                              : tone === "warn"
                                ? "border-amber-600/30 text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"
                        }`}
                      >
                        {resultLabel(p.result)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          {status !== null ? `${count(t, "site", shownStores.length)}. ` : ""}
          Tickd checked {products.length} products and {count(t, "site", summary.stores)}. A {site} has a product if it
          ordered it in the last {days} days.{" "}
          {summary.quietStores > 0 && (
            <>
              {summary.quietStores === 1 ? `1 ${site} has` : `${summary.quietStores} ${sites} have`} not ordered
              anything in that time and {summary.quietStores === 1 ? "is" : "are"} not counted:{" "}
              <Link href={storeReorderHref()} className="text-primary hover:underline">
                see {sites} due for an order
              </Link>
              .{" "}
            </>
          )}
          <Link href="/products/ranges" className="text-primary hover:underline">
            See or change the ranges
          </Link>
          .
        </p>
      )}

      {config?.orgId && (
        <PlanVisitsDialog
          orgId={config.orgId}
          stores={planning}
          open={planning.length > 0}
          onOpenChange={(o) => {
            if (!o) setPlanning([]);
          }}
          tomorrow={tomorrow}
          lastDay={shiftDay(today, NEXT_VISIT_DAYS - 1)}
          onPlanned={(added, already, day, who) => {
            setPlanning([]);
            setNotice(
              `${count(t, "job", added)} planned for ${who || "them"} on ${dayLabel(day, today)}.` +
                (already > 0
                  ? ` ${count(t, "site", already)} ${already === 1 ? "was" : "were"} already on that day.`
                  : ""),
            );
          }}
        />
      )}

      <NotForThisStoreDialog
        target={excluding}
        onClose={() => setExcluding(null)}
        onDone={(n, storeName) => {
          setExcluding(null);
          setNotice(`${n === 1 ? "1 product is" : `${n} products are`} no longer counted for ${storeName}.`);
          setAttempt((x) => x + 1);
        }}
      />
    </div>
  );
}

function flip<K extends string>(cur: SortState<K>, key: K): SortState<K> {
  return cur.key === key
    ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === "name" ? "asc" : "desc" };
}

function MessageRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-10 text-center text-sm text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

/**
 * One store's lines opened up: each product, its state, why it is in the
 * range, what similar stores sell, and "Not for this store" (or its undo).
 */
function StoreRange({
  row,
  lines,
  groupLabel,
  siteWord,
  sitesWord,
  noGroup,
  productName,
  money,
  today,
  canExclude,
  onExclude,
  onInclude,
}: {
  row: RangeStoreRow;
  lines: RangeLine[];
  groupLabel: string | null;
  siteWord: string;
  sitesWord: string;
  noGroup: string;
  productName: (id: string) => string;
  money: ((n: number) => string) | null;
  today: string;
  canExclude: boolean;
  onExclude: (productIds: string[]) => void;
  onInclude: (productId: string) => void;
}) {
  const shown = [...lines].sort(
    (a, b) =>
      order(a) - order(b) ||
      (b.est_value_month ?? 0) - (a.est_value_month ?? 0) ||
      productName(a.product_id).localeCompare(productName(b.product_id)),
  );
  const actionable = shown.filter((l) => l.status === "gap" || l.status === "stopped").map((l) => l.product_id);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {sizeLabel(row.size)} {lower(siteWord)}, {sizeWhy(row.size_source)}.
      </p>
      <ul className="space-y-2">
        {shown.map((l) => (
          <li key={l.product_id} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 text-sm">
              <span className="font-medium text-foreground">{productName(l.product_id)}</span>{" "}
              <span className={`text-xs ${l.status ? STATUS_TEXT[l.status] : "text-muted-foreground"}`}>
                {l.status ? statusLabel(l.status) : "Not counted"}
                {l.last_ordered ? ` · last ordered ${dayLabel(l.last_ordered, today)}` : ""}
              </span>
              <p className="text-xs text-muted-foreground">
                {reasonWords(l, row, groupLabel, siteWord, sitesWord, noGroup)}
              </p>
              {(l.status === "gap" || l.status === "stopped") && l.est_boxes_month !== null && (
                <p className="text-xs text-muted-foreground">
                  Similar {lower(sitesWord)} sell about {l.est_boxes_month.toFixed(1)} boxes a month
                  {money && l.est_value_month ? `, about ${money(l.est_value_month)}` : ""}.
                </p>
              )}
            </div>
            {canExclude && (l.status === "gap" || l.status === "stopped") && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 self-start"
                onClick={() => onExclude([l.product_id])}
              >
                Not for this {lower(siteWord)}
              </Button>
            )}
            {canExclude && l.reason === "excluded" && (
              <Button size="sm" variant="ghost" className="shrink-0 self-start" onClick={() => onInclude(l.product_id)}>
                Count it again
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canExclude && actionable.length > 1 && (
        <Button size="sm" variant="ghost" onClick={() => onExclude(actionable)}>
          None of these are for this {lower(siteWord)}
        </Button>
      )}
    </div>
  );
}

/** Missing and stopped first, then what it has, then the rest. */
function order(l: RangeLine): number {
  switch (l.status) {
    case "gap":
      return 0;
    case "stopped":
      return 1;
    case "have":
      return 2;
    case "off_range":
      return 3;
    case "quiet":
      return 4;
    default:
      return 5;
  }
}
