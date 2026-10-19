"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { storeRangeHref } from "@/lib/dashboard-links";
import { canAccessPath } from "@/lib/permissions";
import { cellWords, fetchRangeGrid, pinLabel, setPin, SIZES, type GridCell, type PinChoice } from "@/lib/range-grid";
import { fetchStoreGroups, NO_STORE_GROUP } from "@/lib/store-groups";
import {
  fetchRangeCatalogue,
  resultLabel,
  resultTone,
  shortNames,
  sizeLabel,
  type RangeProduct,
  type RangeSize,
} from "@/lib/store-range";
import { createClient } from "@/lib/supabase/client";
import { lower } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";
import { usePermissions } from "@/lib/use-permissions";

type GroupChoice = { id: string; name: string; n: number };

const CHOICES: PinChoice[] = [
  { rule: "auto" },
  { rule: "always", from: "big" },
  { rule: "always", from: "medium" },
  { rule: "always", from: "small" },
  { rule: "never" },
];

const same = (a: PinChoice, b: PinChoice) =>
  a.rule === b.rule && (a.rule !== "always" || (b.rule === "always" && a.from === b.from));

/**
 * Ranges (owner, 19 Oct 2026: "this plan must be in a way automatic"): one
 * store group's range as Tickd worked it out from the orders, product by
 * store size, with what it is based on. Nothing to fill in. A product can be
 * pinned (Always from a size, or Never: a chain's head office has not listed
 * it) and unpinned; everything else follows the orders as they come in.
 */
export default function RangesPage() {
  const t = useTerms();
  const permissions = usePermissions();
  const site = lower(t.site.one);
  const sites = lower(t.site.many);
  const group1 = lower(t.site_group.one);

  const [groups, setGroups] = useState<GroupChoice[]>([]);
  const [ungrouped, setUngrouped] = useState(0);
  const [group, setGroup] = useState<string>("");
  const [cells, setCells] = useState<GridCell[]>([]);
  const [catalogue, setCatalogue] = useState<RangeProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // The groups and their store counts, and the products: once.
  useEffect(() => {
    let stale = false;
    const supabase = createClient();
    Promise.all([
      fetchStoreGroups(supabase),
      fetchRangeCatalogue(supabase),
      supabase.from("stores").select("id", { count: "exact", head: true }).eq("active", true),
    ])
      .then(([sg, c, all]) => {
        if (stale) return;
        const n = new Map<string, number>();
        for (const g of sg.groupOf.values()) n.set(g, (n.get(g) ?? 0) + 1);
        const choices = sg.groups
          .map((g) => ({ id: g.id, name: g.name, n: n.get(g.id) ?? 0 }))
          .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
        setGroups(choices);
        setUngrouped(Math.max(0, (all.count ?? 0) - sg.groupOf.size));
        setCatalogue(c);
        // The biggest group first: where a range matters most; the stores with
        // no group when no group has any.
        const noGroup = (all.count ?? 0) - sg.groupOf.size;
        setGroup(
          (cur) =>
            cur ||
            choices.find((g) => g.n > 0)?.id ||
            (noGroup > 0 || choices.length === 0 ? NO_STORE_GROUP : choices[0].id),
        );
      })
      .catch((e: unknown) => {
        if (!stale) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      stale = true;
    };
  }, []);

  // The chosen group's grid, again after every change.
  useEffect(() => {
    if (!group) return;
    let stale = false;
    fetchRangeGrid(createClient(), group === NO_STORE_GROUP ? null : group)
      .then((g) => {
        if (stale) return;
        setCells(g);
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
  }, [group, tick]);

  const names = useMemo(() => shortNames(catalogue), [catalogue]);
  const nameOf = (id: string) => names.get(id) ?? "";

  /** One row per product: its three sizes, and its pin. */
  const rows = useMemo(() => {
    const m = new Map<string, Partial<Record<RangeSize, GridCell>>>();
    for (const c of cells) m.set(c.product_id, { ...(m.get(c.product_id) ?? {}), [c.size]: c });
    const list = [...m.entries()].map(([id, bySize]) => {
      const any = (bySize.big ?? bySize.medium ?? bySize.small)!;
      const pin: PinChoice =
        any.pin_rule === "never"
          ? { rule: "never" }
          : any.pin_rule === "always"
            ? { rule: "always", from: any.pin_min_size ?? "small" }
            : { rule: "auto" };
      const inRange = SIZES.filter((s) => bySize[s]?.cluster_in).length;
      return { id, bySize, pin, stage: any.stage, result: any.result, inRange };
    });
    return list.sort((a, b) => b.inRange - a.inRange || nameOf(a.id).localeCompare(nameOf(b.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, names]);

  const sizesHere = SIZES.filter((s) => cells.some((c) => c.size === s));
  const pinnable = group !== NO_STORE_GROUP;
  const groupNameNow =
    group === NO_STORE_GROUP ? `${t.site.many} with no ${group1}` : (groups.find((g) => g.id === group)?.name ?? "");

  async function choose(productId: string, choice: PinChoice, everyGroup: boolean) {
    setSaving(productId);
    setNotice(null);
    try {
      await setPin(createClient(), everyGroup ? null : group, productId, choice);
      setNotice(
        `${nameOf(productId)}: ${pinLabel(choice, t.site.one, t.site.many).toLowerCase()}${everyGroup ? ` in every ${group1}` : ` for ${groupNameNow}`}.`,
      );
      setTick((n) => n + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const seesRangePage = permissions !== null && canAccessPath(permissions, "/stores/range");

  /** The words under each size, in the company's terms. */
  const words = { group: t.site_group.one, site: t.site.one, sites: t.site.many };
  const menu: MenuProps = {
    groupName: groupNameNow,
    group1,
    site: t.site.one,
    sites: t.site.many,
    saving,
    nameOf,
    choose: (id, c, every) => void choose(id, c, every),
  };

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Ranges</h1>
        <p className="text-sm text-muted-foreground">
          Which products each {site} should have. Tickd works it out from your orders: it compares each {site} with
          similar ones (the same {group1}, and big, medium or small), and judges new products by whether {sites} order
          them again. Change a product only if you know better, for example when the head office of a {group1} has not
          listed it.
        </p>
        {seesRangePage && (
          <p className="mt-1 text-sm">
            <Link href={storeRangeHref("missing")} className="text-primary hover:underline">
              See what is missing from your {sites}
            </Link>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="range-group">{t.site_group.one}</Label>
        <div className="max-w-xs">
          <NativeSelect
            id="range-group"
            value={group}
            onChange={(e) => {
              setLoading(true);
              setNotice(null);
              setGroup(e.target.value);
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.n} {g.n === 1 ? site : sites})
              </option>
            ))}
            {ungrouped > 0 && (
              <option value={NO_STORE_GROUP}>
                No {group1} ({ungrouped} {ungrouped === 1 ? site : sites})
              </option>
            )}
          </NativeSelect>
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {notice}
        </p>
      )}
      {!pinnable && (
        <p className="text-sm text-muted-foreground">
          Tickd works out the range of {sites} with no {group1} too. To set products by hand, give the {sites} a{" "}
          {group1} first.
        </p>
      )}

      <div className="hidden overflow-x-auto rounded-xl ring-1 ring-foreground/10 sm:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Product</TableHead>
              {SIZES.map((s) => (
                <TableHead key={s} className="text-center">
                  {sizeLabel(s)}
                </TableHead>
              ))}
              {pinnable && (
                <TableHead className="w-0">
                  <span className="sr-only">Change</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <EmptyRow colSpan={5}>Loading the range…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={5}>
                {catalogue.length === 0
                  ? "Add your products, and Tickd will work out each range from your orders."
                  : `This ${group1} has no active ${sites}.`}
              </EmptyRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="min-w-[140px] whitespace-normal align-top text-sm">
                    <span className="font-medium text-foreground">{nameOf(r.id)}</span>
                    <ProductBadges row={r} site={t.site.one} sites={t.site.many} />
                  </TableCell>
                  {SIZES.map((s) => (
                    <TableCell key={s} className="min-w-[96px] whitespace-normal text-center align-top text-xs">
                      <SizeCell cell={r.bySize[s]} size={s} shown={sizesHere.includes(s)} words={words} />
                    </TableCell>
                  ))}
                  {pinnable && (
                    <TableCell className="align-top">
                      <PinMenu row={r} menu={menu} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {/* On a phone the three sizes sit side by side under each product, so nothing scrolls sideways. */}
      <ul className="divide-y divide-border rounded-xl ring-1 ring-foreground/10 sm:hidden">
        {loading ? (
          <li className="p-6 text-center text-sm text-muted-foreground">Loading the range…</li>
        ) : rows.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">
            {catalogue.length === 0
              ? "Add your products, and Tickd will work out each range from your orders."
              : `This ${group1} has no active ${sites}.`}
          </li>
        ) : (
          rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{nameOf(r.id)}</p>
                <ProductBadges row={r} site={t.site.one} sites={t.site.many} />
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  {SIZES.map((s) => (
                    <div key={s}>
                      <dt className="font-medium text-foreground">{sizeLabel(s)}</dt>
                      <dd>
                        <SizeCell cell={r.bySize[s]} size={s} shown={sizesHere.includes(s)} words={words} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              {pinnable && <PinMenu row={r} menu={menu} />}
            </li>
          ))
        )}
      </ul>
      <p className="text-xs text-muted-foreground">
        A {site} is big, medium or small against the others in its {group1}, by how much it orders. A {site} with few
        orders yet is sized from how often it is visited. You can set a {site}&rsquo;s size yourself on {t.site.many}.
      </p>
    </div>
  );
}

type Row = {
  id: string;
  bySize: Partial<Record<RangeSize, GridCell>>;
  pin: PinChoice;
  stage: GridCell["stage"];
  result: GridCell["result"];
  inRange: number;
};

/** "Set by you" and a new product's result, under its name. */
function ProductBadges({ row, site, sites }: { row: Row; site: string; sites: string }) {
  const tone = row.result ? resultTone(row.result) : undefined;
  if (row.pin.rule === "auto" && (row.stage === "established" || !row.result)) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {row.pin.rule !== "auto" && (
        <Badge variant="outline" className="border-amber-600/30 text-amber-700 dark:text-amber-400">
          Set by you: {pinLabel(row.pin, site, sites).toLowerCase()}
        </Badge>
      )}
      {row.stage !== "established" && row.result && (
        <Badge
          variant="outline"
          className={
            tone === "good"
              ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400"
              : tone === "bad"
                ? "border-red-600/30 text-red-700 dark:text-red-400"
                : tone === "warn"
                  ? "border-amber-600/30 text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground"
          }
        >
          New: {resultLabel(row.result).toLowerCase()}
        </Badge>
      )}
    </span>
  );
}

/** One size of one product: in range or not, and what it is based on. */
function SizeCell({
  cell,
  size,
  shown,
  words,
}: {
  cell: GridCell | undefined;
  size: RangeSize;
  /** The group has stores of this size (only this product is missing a row). */
  shown: boolean;
  words: { group: string; site: string; sites: string };
}) {
  const site = lower(words.site);
  const sites = lower(words.sites);
  if (!cell) return <span className="text-muted-foreground">{shown ? "" : `No ${size} ${sites}`}</span>;
  return (
    <>
      {cell.cluster_in ? (
        <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" aria-hidden /> In range
        </span>
      ) : (
        <span className="text-muted-foreground">Not in range</span>
      )}
      <span className="block text-muted-foreground">{cellWords(cell, words.group, words.sites)}</span>
      {cell.own_in > 0 && (
        <span className="block text-muted-foreground">
          {cell.own_in === 1 ? `1 more ${site} orders it` : `${cell.own_in} more ${sites} order it`}
        </span>
      )}
    </>
  );
}

type MenuProps = {
  groupName: string;
  group1: string;
  site: string;
  sites: string;
  /** The product being saved, whose menu waits. */
  saving: string | null;
  nameOf: (id: string) => string;
  choose: (productId: string, choice: PinChoice, everyGroup: boolean) => void;
};

/** Override one product: for this group, or for every group. */
function PinMenu({ row, menu }: { row: Row; menu: MenuProps }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            disabled={menu.saving === row.id}
            aria-label={`Change ${menu.nameOf(row.id)}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>For {menu.groupName}</DropdownMenuLabel>
          {CHOICES.map((c) => (
            <DropdownMenuItem
              key={pinLabel(c, menu.site, menu.sites)}
              onClick={() => menu.choose(row.id, c, false)}
              disabled={same(c, row.pin)}
            >
              {pinLabel(c, menu.site, menu.sites)}
              {same(c, row.pin) && <Check className="ml-auto h-4 w-4" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>In every {menu.group1}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => menu.choose(row.id, { rule: "never" }, true)}>Never</DropdownMenuItem>
          <DropdownMenuItem onClick={() => menu.choose(row.id, { rule: "auto" }, true)}>Tickd decides</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
