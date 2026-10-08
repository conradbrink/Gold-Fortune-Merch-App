"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { fetchContracts, runContractsNow, type ContractListRow } from "@/lib/contracts";
import { formatDateOnly } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

/**
 * Every contract: what it charges, how often, and when it next invoices. The
 * database invoices them by itself each morning; "Invoice what is due now"
 * does the same at once, for a contract added after this morning's run.
 */
export default function ContractsPage() {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const currency = config?.settings.currency_code ?? "";
  const on = config?.settings.money_contracts ?? true;
  const [rows, setRows] = useState<ContractListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const load = useCallback(async () => {
    try {
      setRows(await fetchContracts(supabase));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function runNow() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const n = await runContractsNow(supabase);
      setNotice(n === 0 ? "Nothing was due." : `${n} invoice${n === 1 ? "" : "s"} issued.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Contracts</h1>
          <p className="text-sm text-muted-foreground">
            A fixed fee per {t.site.one.toLowerCase()}, invoiced automatically each month or quarter, early each
            morning on its invoice day.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy || !on} onClick={runNow}>
            Invoice what is due now
          </Button>
          <Button nativeButton={false} render={<Link href="/contracts/new" />} disabled={!on}>
            <Plus className="mr-1.5 h-4 w-4" /> New contract
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{notice}</p>}
      {config && !on && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          Contracts are switched off for this company. Switch them on under Settings → Company → Quotes &amp; invoices.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>{t.site.one}</TableHead>
              <TableHead>Invoiced</TableHead>
              <TableHead className="text-right">Each period</TableHead>
              <TableHead>Next invoice</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
            {!loading && rows.length === 0 && <EmptyRow colSpan={6}>No contracts yet.</EmptyRow>}
            {rows.map((c) => {
              const ended = c.ends_on !== null && c.ends_on < today;
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/contracts/${c.id}`)}>
                  <TableCell className="font-medium">
                    <Link href={`/contracts/${c.id}`} className="text-primary hover:underline">
                      {c.name}
                    </Link>
                    {c.last_run_error && <div className="text-xs text-destructive">{c.last_run_error}</div>}
                  </TableCell>
                  <TableCell>{c.store_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.period === "quarterly" ? "Quarterly" : "Monthly"}, {c.billing === "arrears" ? "in arrears" : "in advance"},
                    day {c.invoice_day}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(c.monthly_value, currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {c.active && c.next_invoice_on ? formatDateOnly(c.next_invoice_on) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.active && !ended ? "secondary" : "outline"}>
                      {!c.active ? "Paused" : ended ? "Ended" : "Active"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
