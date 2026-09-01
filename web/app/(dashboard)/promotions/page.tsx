"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgePercent, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromotionDialog } from "@/components/promotions/promotion-dialog";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgId } from "@/lib/representatives";
import {
  deletePromotion,
  fetchPromotionSummaries,
  fetchStoreStatus,
  isLive,
  setPromotionActive,
  verdictFor,
  VERDICT_LABELS,
  VERDICT_STYLES,
  type PromotionStoreStatus,
  type PromotionSummary,
  type Verdict,
} from "@/lib/promotions";

function formatDate(iso: string): string {
  // Split into parts rather than `new Date(iso)` — that parses as midnight UTC
  // and renders 1 August as 31 July in Botswana.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export default function PromotionsPage() {
  const supabase = createClient();

  const [rows, setRows] = useState<PromotionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detail, setDetail] = useState<PromotionSummary | null>(null);
  const [statuses, setStatuses] = useState<PromotionStoreStatus[]>([]);
  // Unanswered first, mirroring the RPC's own sort: a manager opening this is
  // looking for the gap, not admiring the coverage.
  const [verdictFilter, setVerdictFilter] = useState<Verdict | "all">("not_checked");
  const [confirmDelete, setConfirmDelete] = useState<PromotionSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaries, org] = await Promise.all([
        fetchPromotionSummaries(supabase),
        fetchOrgId(supabase),
      ]);
      setRows(summaries);
      setOrgId(org);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `load` still starts before this returns.
    void (async () => {
      await load();
    })();
  }, [load]);

  async function openDetail(p: PromotionSummary) {
    setDetail(p);
    setVerdictFilter("not_checked");
    try {
      setStatuses(await fetchStoreStatus(supabase, p.promotion_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const verdictCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!detail) return counts;
    for (const s of statuses) {
      const v = verdictFor(s, detail.products);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  }, [statuses, detail]);

  const shown = useMemo(() => {
    if (!detail) return [];
    return statuses.filter((s) =>
      verdictFilter === "all" ? true : verdictFor(s, detail.products) === verdictFilter
    );
  }, [statuses, verdictFilter, detail]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Promotions
          </h1>
          <p className="text-sm text-muted-foreground">
            Deals running at named outlets, confirmed by the rep standing there.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New promotion
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Promotion</TableHead>
              <TableHead className="hidden md:table-cell">Runs</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Outlets</TableHead>
              <TableHead className="text-right">Checked</TableHead>
              <TableHead className="text-right">Running</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <BadgePercent className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    No promotions yet.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create one and it appears on a rep&apos;s phone at every outlet
                    it covers, for the dates it runs.
                  </p>
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow
                key={p.promotion_id}
                className="cursor-pointer"
                onClick={() => openDetail(p)}
              >
                <TableCell>
                  <p className="text-sm font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {isLive(p)
                      ? "Running now"
                      : !p.active
                        ? "Switched off"
                        : "Not running today"}
                    {/* Neutral, not red: a promotion nobody ranges is a buyer's
                        problem, and reads identically to a failing one without
                        this. */}
                    {p.stores_not_stocked > 0 && (
                      <>
                        {" · "}
                        <span className="text-amber-700 dark:text-amber-400">
                          not ranged at {p.stores_not_stocked} of {p.stores}
                        </span>
                      </>
                    )}
                  </p>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-sm md:table-cell">
                  {formatDate(p.starts_on)} – {formatDate(p.ends_on)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">{p.products}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">{p.stores}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {p.stores_checked}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {p.stores_running}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(p.promotion_id);
                          setDialogOpen(true);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={async () => {
                          await setPromotionActive(supabase, p.promotion_id, !p.active);
                          load();
                        }}
                      >
                        {p.active ? "Switch off" : "Switch on"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setConfirmDelete(p)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {confirmDelete && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-semibold text-destructive">
            Delete “{confirmDelete.name}”?
          </p>
          <p className="mt-1 text-xs text-foreground">
            Every answer reps have recorded against it goes too. Switching it off
            keeps the record and simply stops it appearing on any phone.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                await deletePromotion(supabase, confirmDelete.promotion_id);
                setConfirmDelete(null);
                load();
              }}
            >
              Delete anyway
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await setPromotionActive(supabase, confirmDelete.promotion_id, false);
                setConfirmDelete(null);
                load();
              }}
            >
              Switch off instead
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <PromotionDialog
        promotionId={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orgId={orgId}
        onSaved={load}
      />

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <>
              {detail.brief && (
                <p className="-mt-2 text-sm text-muted-foreground">{detail.brief}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {formatDate(detail.starts_on)} – {formatDate(detail.ends_on)} ·{" "}
                {detail.products} line{detail.products === 1 ? "" : "s"} ·{" "}
                {detail.stores} outlet{detail.stores === 1 ? "" : "s"}
              </p>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["not_checked", VERDICT_LABELS.not_checked],
                    ["partly", VERDICT_LABELS.partly],
                    ["running", VERDICT_LABELS.running],
                    ["not_running", VERDICT_LABELS.not_running],
                    ["not_stocked", VERDICT_LABELS.not_stocked],
                    ["all", "All"],
                  ] as [Verdict | "all", string][]
                ).map(([key, label]) => {
                  const n = key === "all" ? statuses.length : (verdictCounts[key] ?? 0);
                  // An empty group is noise, but the selected one stays so the
                  // filter cannot blank itself out from under the reader.
                  if (n === 0 && key !== "all" && verdictFilter !== key) return null;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setVerdictFilter(key)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        verdictFilter === key
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {label} ({n})
                    </button>
                  );
                })}
              </div>

              <ul className="divide-y divide-border rounded-lg border border-border">
                {shown.length === 0 && (
                  <li className="p-4 text-center text-sm text-muted-foreground">
                    Nothing in this group.
                  </li>
                )}
                {shown.map((s) => {
                  const v = verdictFor(s, detail.products);
                  return (
                    <li
                      key={s.store_id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{s.store_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.city ?? "—"}
                          {s.rep_name && ` · last answered by ${s.rep_name}`}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT_STYLES[v]}`}
                      >
                        {v === "partly"
                          ? `${VERDICT_LABELS.partly} (${s.answered} of ${detail.products})`
                          : v === "running" && s.running < detail.products
                            ? `${VERDICT_LABELS.running} (${s.running} of ${detail.products})`
                            : VERDICT_LABELS[v]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
