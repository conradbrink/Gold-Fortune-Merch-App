"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, RefreshCw, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { exportCsv } from "@/lib/export";
import {
  byRep,
  fetchCommissions,
  recalculate,
  setStatus,
  STATUS_LABELS,
  type CommissionRow,
} from "@/lib/commissions";

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthRange(offset: number) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: ymd(from), to: ymd(to) };
}

/**
 * Commissions for a period, and the payroll view of the same rows.
 *
 * The period is by delivery date — the day the sale counted — so this month's
 * payroll is this month's deliveries, the same month the Sales page and the
 * targets put them in. Approve, then mark paid once the money has gone; paid
 * is final, and an approved commission is frozen against later rule changes.
 */
export default function CommissionsPage() {
  const supabase = createClient();
  const [{ from, to }, setRange] = useState(() => monthRange(0));
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [status, setStatusFilter] = useState("all");
  const [rep, setRep] = useState("all");
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // `to` is the last day shown, inclusive; the query wants the moment after it.
  const range = useMemo(() => {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    return { from: new Date(`${from}T00:00:00`), to: end };
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchCommissions(supabase, range));
      setSelected(new Set());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, range]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const reps = useMemo(
    () => [...new Map(rows.map((r) => [r.rep_id, r.rep_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [rows]
  );
  const visible = rows.filter(
    (r) => (status === "all" || r.status === status) && (rep === "all" || r.rep_id === rep)
  );
  const totals = useMemo(() => {
    const t = { pending: 0, approved: 0, paid: 0, pendingN: 0, approvedN: 0 };
    for (const r of rows) {
      t[r.status as "pending" | "approved" | "paid"] += Number(r.amount);
      if (r.status === "pending") t.pendingN += 1;
      if (r.status === "approved") t.approvedN += 1;
    }
    return t;
  }, [rows]);

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const chosen = visible.filter((r) => selected.has(r.id));
  const move = (to: "pending" | "approved" | "paid", verb: string) =>
    act(async () => {
      const n = await setStatus(supabase, chosen.map((r) => r.id), to);
      const skipped = chosen.length - n;
      return `${n} ${verb}.` + (skipped > 0 ? ` ${skipped} were not in a state that allows it.` : "");
    });

  function exportRows(only?: "approved") {
    const list = only ? visible.filter((r) => r.status === only) : visible;
    exportCsv({
      title: only ? "Approved commissions" : "Commissions",
      context: [`Delivered ${from} to ${to}`],
      filename: only ? "commissions-approved" : "commissions",
      columns: [
        { header: "Rep", key: "rep" },
        { header: "Order", key: "order" },
        { header: "Store", key: "store" },
        { header: "Delivered", key: "delivered" },
        { header: "Order value excl. VAT", key: "value", numeric: true },
        { header: "Rule", key: "rule" },
        { header: "Commission", key: "amount", numeric: true },
        { header: "Status", key: "status" },
      ],
      rows: list.map((r) => ({
        rep: r.rep_name,
        order: r.order_number,
        store: r.store_name,
        delivered: r.delivered_at.slice(0, 10),
        value: Number(r.order_value).toFixed(2),
        rule: r.rule_name,
        amount: Number(r.amount).toFixed(2),
        status: STATUS_LABELS[r.status] ?? r.status,
      })),
    });
  }

  function exportPayroll() {
    exportCsv({
      title: "Commission payroll",
      context: [`Delivered ${from} to ${to}`],
      filename: "commission-payroll",
      columns: [
        { header: "Rep", key: "rep" },
        { header: "Orders", key: "orders", numeric: true },
        { header: "Order value excl. VAT", key: "value", numeric: true },
        { header: "Pending", key: "pending", numeric: true },
        { header: "Approved (to pay)", key: "approved", numeric: true },
        { header: "Paid", key: "paid", numeric: true },
      ],
      rows: byRep(rows).map((r) => ({
        rep: r.repName,
        orders: r.orders,
        value: r.orderValue.toFixed(2),
        pending: r.pending.toFixed(2),
        approved: r.approved.toFixed(2),
        paid: r.paid.toFixed(2),
      })),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Commissions</h1>
          <p className="text-sm text-muted-foreground">
            One per delivered order, from the best matching rule. By delivery date.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const n = await recalculate(supabase, range);
                return `Recalculated ${n} delivered orders. Approved and paid commissions were left as they are.`;
              })
            }
          >
            <RefreshCw className="mr-1.5 h-4 w-4" /> Recalculate period
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/commissions/rules" />}>
            <Settings2 className="mr-1.5 h-4 w-4" /> Rules
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRange(monthRange(0))}>
          This month
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRange(monthRange(-1))}>
          Last month
        </Button>
        <Input
          type="date"
          value={from}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          className="w-40"
          aria-label="From"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          className="w-40"
          aria-label="To"
        />
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">{notice}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Pending approval" value={money(totals.pending)} sub={`${totals.pendingN} commissions`} />
        <Tile label="Approved, not paid" value={money(totals.approved)} sub={`${totals.approvedN} commissions`} />
        <Tile label="Paid" value={money(totals.paid)} />
        <Tile label="Total for period" value={money(totals.pending + totals.approved + totals.paid)} />
      </div>

      <Tabs value={view} onValueChange={(v) => setView(String(v))}>
        <TabsList>
          <TabsTrigger value="list">Commissions</TabsTrigger>
          <TabsTrigger value="payroll">By rep (payroll)</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "list" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={status} onChange={(e) => setStatusFilter(e.target.value)} className="w-40" aria-label="Status">
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={rep} onChange={(e) => setRep(e.target.value)} className="w-48" aria-label="Rep">
              <option value="all">All reps</option>
              {reps.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
            <div className="ml-auto flex flex-wrap gap-2">
              {chosen.length > 0 && (
                <>
                  <Button size="sm" disabled={busy} onClick={() => move("approved", "approved")}>
                    Approve {chosen.length}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => move("paid", "marked paid")}>
                    Mark paid
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => move("pending", "sent back to pending")}>
                    Unapprove
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={() => exportRows()}>
                <Download className="mr-1.5 h-4 w-4" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => exportRows("approved")}>
                Approved only
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={visible.length > 0 && chosen.length === visible.length}
                      onCheckedChange={(on) =>
                        setSelected(on ? new Set(visible.map((r) => r.id)) : new Set())
                      }
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Rep</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead className="text-right">Order value</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <EmptyRow colSpan={8}>Loading…</EmptyRow>}
                {!loading && visible.length === 0 && (
                  <EmptyRow colSpan={8}>
                    No commissions for this period. Add a rule, then Recalculate period.
                  </EmptyRow>
                )}
                {!loading &&
                  visible.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={(on) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (on) next.add(r.id);
                              else next.delete(r.id);
                              return next;
                            })
                          }
                          aria-label={`Select ${r.order_number}`}
                        />
                      </TableCell>
                      <TableCell>{r.rep_name}</TableCell>
                      <TableCell>
                        <Link href={`/orders/${r.order_id}`} className="text-primary hover:underline">
                          {r.order_number}
                        </Link>
                        {r.store_name && (
                          <div className="text-xs text-muted-foreground">{r.store_name}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(r.delivered_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(Number(r.order_value))}</TableCell>
                      <TableCell className="text-sm">
                        {r.rule_name}
                        {r.rate != null && (
                          <span className="text-muted-foreground"> · {Number(r.rate)}%</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(Number(r.amount))}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "paid" ? "outline" : r.status === "approved" ? "default" : "secondary"}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={exportPayroll}>
              <Download className="mr-1.5 h-4 w-4" /> Payroll CSV
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rep</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Order value</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Approved (to pay)</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && rows.length === 0 && <EmptyRow colSpan={6}>No commissions for this period.</EmptyRow>}
                {byRep(rows).map((r) => (
                  <TableRow key={r.repId}>
                    <TableCell className="font-medium">{r.repName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.orderValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.pending)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(r.approved)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.paid)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
