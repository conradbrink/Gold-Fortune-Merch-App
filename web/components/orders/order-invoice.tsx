"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { fetchInvoiceForOrder, issueInvoice } from "@/lib/invoices";

/**
 * The order's invoice row: a link to the app's tax invoice, the QuickBooks
 * number it was invoiced under before the app issued invoices, or — once the
 * order has gone out and has neither — the button that issues one.
 *
 * The database refuses an order that already carries a QuickBooks number, so
 * the button is not offered for one; the refusal would only repeat this row.
 */
export function OrderInvoice({
  orderId,
  status,
  invoiceNumber,
}: {
  orderId: string;
  status: string;
  invoiceNumber: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [invoice, setInvoice] = useState<{ id: string; invoice_number: string } | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `checked` only on success: a failed lookup must not read as "no invoice"
    // and offer to issue one for an order that may already have it.
    fetchInvoiceForOrder(supabase, orderId)
      .then((inv) => {
        if (cancelled) return;
        setInvoice(inv);
        setChecked(true);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [supabase, orderId]);

  const canIssue = checked && !invoice && !invoiceNumber && (status === "dispatched" || status === "delivered");

  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">Invoice</span>
      <span className="text-right">
        {invoice ? (
          <Link href={`/invoices/${invoice.id}`} className="font-medium text-primary hover:underline">
            {invoice.invoice_number}
          </Link>
        ) : invoiceNumber ? (
          <>
            {invoiceNumber}
            <span className="block text-xs text-muted-foreground">Invoiced outside the app</span>
          </>
        ) : canIssue ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("Issue a tax invoice for this order? It cannot be edited afterwards — only credited or voided.")) return;
              setBusy(true);
              setError(null);
              try {
                const id = await issueInvoice(supabase, orderId);
                router.push(`/invoices/${id}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            {busy ? "Issuing…" : "Issue tax invoice"}
          </Button>
        ) : (
          "Not yet raised"
        )}
        {error && <span className="mt-1 block max-w-64 text-xs text-destructive">{error}</span>}
      </span>
    </div>
  );
}
