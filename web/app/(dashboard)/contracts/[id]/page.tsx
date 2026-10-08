"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { ContractForm, contractProblem, type ContractDraft } from "@/components/money/contract-form";
import { type EditableLine } from "@/components/money/line-editor";
import { fetchOrgId } from "@/lib/representatives";
import { fetchStoresForOrder } from "@/lib/orders";
import { fetchServiceItems, type ServiceItem } from "@/lib/service-items";
import { fetchDocumentSettings, type DocumentSettings } from "@/lib/document-settings";
import {
  deleteContract,
  fetchContract,
  reinvoicePeriod,
  runContractsNow,
  updateContract,
  type ContractDetail,
} from "@/lib/contracts";
import { periodLabel } from "@/lib/contract-periods";
import { formatDateOnly } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

/**
 * One contract: its terms and lines (editable; how it is billed is fixed once
 * it has been invoiced), its invoices period by period, and the actions the
 * office needs between runs: invoice what is due now, invoice a voided period
 * again, pause, end.
 */
export default function ContractPage() {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const currency = config?.settings.currency_code ?? "";

  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentSettings | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [draft, setDraft] = useState<ContractDraft | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, org, docs, s, si] = await Promise.all([
        fetchContract(supabase, id),
        fetchOrgId(supabase),
        fetchDocumentSettings(supabase),
        fetchStoresForOrder(supabase),
        fetchServiceItems(supabase, { activeOnly: true }),
      ]);
      setDetail(d);
      setOrgId(org);
      setDoc(docs);
      setStores(s);
      setItems(si);
      const c = d.contract;
      setDraft({
        storeId: c.store_id,
        name: c.name,
        period: c.period as ContractDraft["period"],
        billing: c.billing as ContractDraft["billing"],
        invoiceDay: String(c.invoice_day),
        startsOn: c.starts_on,
        endsOn: c.ends_on ?? "",
        reference: c.reference ?? "",
        notes: c.notes ?? "",
        active: c.active,
      });
      setLines(
        d.lines.map((l) => ({
          key: l.id,
          serviceItemId: l.service_item_id,
          description: l.description,
          unit: l.unit ?? "",
          qty: String(l.qty),
          price: String(l.unit_price),
        }))
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [supabase, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!detail || !draft) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} />
        {!error && <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>
    );
  }

  const c = detail.contract;
  const invoiced = detail.invoices.length > 0;

  const save = (patch: Partial<ContractDraft> = {}) =>
    run(async () => {
      if (!orgId) return;
      const next = { ...draft, ...patch };
      const problem = contractProblem(next, lines, t);
      if (problem) throw new Error(problem);
      await updateContract(
        supabase,
        c.id,
        {
          ...next,
          invoiceDay: Number(next.invoiceDay),
          endsOn: next.endsOn || null,
          reference: next.reference || null,
          notes: next.notes || null,
        },
        lines.map((l) => ({
          serviceItemId: l.serviceItemId,
          description: l.description,
          unit: l.unit || null,
          qty: Number(l.qty),
          unitPrice: Number(l.price),
        }))
      );
      return "Saved.";
    });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/contracts" className="text-sm text-muted-foreground hover:text-foreground">
            ← Contracts
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{c.name}</h1>
            <Badge variant={c.active ? "secondary" : "outline"}>{c.active ? "Active" : "Paused"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.storeName}
            {c.active && c.next_invoice_on ? ` · next invoice ${formatDateOnly(c.next_invoice_on)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || !c.active}
            onClick={() =>
              run(async () => {
                const n = await runContractsNow(supabase, c.id);
                return n === 0 ? "Nothing was due." : `${n} invoice${n === 1 ? "" : "s"} issued.`;
              })
            }
          >
            Invoice what is due now
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => save({ active: !c.active })}>
            {c.active ? "Pause" : "Resume"}
          </Button>
          {!invoiced && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!window.confirm(`Delete "${c.name}"? It has never been invoiced.`)) return;
                  await deleteContract(supabase, c.id);
                  router.push("/contracts");
                })
              }
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner message={error ?? c.last_run_error} />
      {notice && <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{notice}</p>}

      <ContractForm
        draft={draft}
        onChange={setDraft}
        lines={lines}
        onLinesChange={setLines}
        stores={stores}
        items={items}
        currency={currency}
        vatRate={Number(doc?.vat_rate ?? 0)}
        pricesIncludeVat={doc?.prices_include_vat ?? false}
        termsFixed={invoiced}
        today={null}
        disabled={busy}
      />
      <div className="flex justify-end">
        <Button onClick={() => save()} disabled={busy}>
          Save changes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {c.next_invoice_on
                ? `None yet. The first goes out on ${formatDateOnly(c.next_invoice_on)}.`
                : "None yet."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.invoices.map((i) => (
                  <TableRow key={i.invoice_id}>
                    <TableCell>{periodLabel(i.period_start, i.period_end)}</TableCell>
                    <TableCell>
                      <Link href={`/invoices/${i.invoice_id}`} className="text-primary hover:underline">
                        {i.invoice_number}
                      </Link>
                      {i.status === "void" && <span className="ml-2 text-xs text-destructive">void</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateOnly(i.issue_date)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${i.status === "void" ? "text-muted-foreground line-through" : ""}`}>
                      {formatMoney(i.total, currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      {i.status === "void" && i.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              if (!window.confirm(`Invoice ${periodLabel(i.period_start, i.period_end)} again, now?`)) return;
                              const newId = await reinvoicePeriod(supabase, c.id, i.period_start);
                              router.push(`/invoices/${newId}`);
                            })
                          }
                        >
                          Invoice again
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
