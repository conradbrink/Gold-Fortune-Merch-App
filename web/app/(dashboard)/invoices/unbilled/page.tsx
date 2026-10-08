"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { formatDateOnly } from "@/lib/format-date";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import type { Database } from "@/lib/supabase/types";

type Unbilled = Database["public"]["Functions"]["unbilled_visits"]["Returns"][number];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Unbilled work: finished jobs in a period that are on no invoice, by place —
 * the money still to be asked for. Work a contract covers is left out (the
 * contract bills it). "Invoice these" opens New invoice for that place and
 * period with the jobs ticked.
 */
export default function UnbilledPage() {
  const supabase = createClient();
  const t = useTerms();
  const [range, setRange] = useState(() => {
    const now = new Date();
    return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(now) };
  });
  const [rows, setRows] = useState<Unbilled[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setRows([]);
    (async () => {
      try {
        // A page at a time: the API returns at most 1,000 rows a response.
        const out: Unbilled[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error: e } = await supabase
            .rpc("unbilled_visits", { p_store_id: null, p_from: range.from, p_to: range.to })
            .range(from, from + 999);
          if (e) throw new Error(e.message);
          const page = (data ?? []) as Unbilled[];
          out.push(...page);
          if (page.length < 1000) break;
        }
        if (!cancelled) {
          setRows(out);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, range]);

  const groups = useMemo(() => {
    const by = new Map<string, { storeId: string; name: string; jobs: number; minutes: number; first: string; last: string }>();
    for (const r of rows) {
      const day = (r.checkin_at ?? "").slice(0, 10);
      const g = by.get(r.store_id) ?? { storeId: r.store_id, name: r.store_name, jobs: 0, minutes: 0, first: day, last: day };
      g.jobs += 1;
      g.minutes += r.minutes ?? 0;
      if (day && day < g.first) g.first = day;
      if (day > g.last) g.last = day;
      by.set(r.store_id, g);
    }
    return [...by.values()].sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name));
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
            ← Invoices
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Unbilled work</h1>
          <p className="text-sm text-muted-foreground">
            {`Finished ${lower(t.job.many)} that are on no invoice yet. Work a contract covers is billed by the contract.`}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="u-from">From</Label>
            <Input id="u-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-40" />
          </div>
          <div>
            <Label htmlFor="u-to">To</Label>
            <Input id="u-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-40" />
          </div>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.site.one}</TableHead>
              <TableHead className="text-right">{t.job.many}</TableHead>
              <TableHead>First</TableHead>
              <TableHead>Last</TableHead>
              <TableHead className="text-right">Hours on site</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
            {!loading && groups.length === 0 && (
              <EmptyRow colSpan={6}>{error ? "Could not load the work for these dates." : "Nothing waiting to be invoiced in these dates."}</EmptyRow>
            )}
            {groups.map((g) => (
              <TableRow key={g.storeId}>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell className="text-right tabular-nums">{g.jobs}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateOnly(g.first)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateOnly(g.last)}</TableCell>
                <TableCell className="text-right tabular-nums">{(Math.round(g.minutes / 6) / 10).toLocaleString("en-GB")}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    nativeButton={false}
                    render={
                      <Link
                        href={`/invoices/new?source=jobs&store=${g.storeId}&from=${range.from}&to=${range.to}`}
                      />
                    }
                  >
                    Invoice these
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
