import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatRandExact, parseLines } from "@/lib/billing";
import { PrintButton } from "@/components/billing/print-button";
import { PRODUCT_MARK, PRODUCT_NAME } from "@/lib/product";

/**
 * One invoice or credit note, ready to print or save as PDF (Stage 6).
 *
 * Everything on it is the invoice row as issued: the seller's and the buyer's
 * details were copied onto it on the day, so a later change of address does
 * not rewrite it. Read with the caller's session: RLS shows a company's
 * invoices only to its company-settings managers.
 *
 * "Tax Invoice" with VAT only when the seller was VAT registered on the day;
 * otherwise a plain invoice with no VAT line (owner, 8 Oct 2026: not registered
 * yet).
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice" };

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: inv } = await supabase.from("billing_invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) notFound();

  const seller = (inv.seller ?? {}) as Record<string, unknown>;
  const buyer = (inv.buyer ?? {}) as Record<string, unknown>;
  const lines = parseLines(inv.lines);
  const credit = inv.kind === "credit_note";
  const title = credit ? "Credit note" : inv.vat_registered ? "Tax Invoice" : "Invoice";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/billing" className="text-sm text-muted-foreground hover:underline">
          ← Billing
        </Link>
        <PrintButton />
      </div>

      <article className="space-y-6 rounded-lg border border-border bg-card p-8 text-sm text-card-foreground print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {/* The service's own mark: this invoice is from the seller of the
                product, not from the company's branding. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PRODUCT_MARK} alt={PRODUCT_NAME} width={44} height={44} className="size-11 rounded-lg" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="text-muted-foreground">{inv.number}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-medium">{text(seller.name) || "—"}</p>
            {text(seller.address) && <p className="whitespace-pre-line text-muted-foreground">{text(seller.address)}</p>}
            {text(seller.email) && <p className="text-muted-foreground">{text(seller.email)}</p>}
            {inv.vat_registered && text(seller.vat_number) && <p className="text-muted-foreground">VAT number {text(seller.vat_number)}</p>}
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Billed to</p>
            <p className="font-medium">{text(buyer.name)}</p>
            {text(buyer.address) && <p className="whitespace-pre-line text-muted-foreground">{text(buyer.address)}</p>}
            {text(buyer.vat_number) && <p className="text-muted-foreground">VAT number {text(buyer.vat_number)}</p>}
          </div>
          <div className="sm:text-right">
            <p>
              <span className="text-muted-foreground">Date: </span>
              {formatDate(inv.issued_at)}
            </p>
            {inv.period_start && inv.period_end && (
              <p>
                <span className="text-muted-foreground">Period: </span>
                {formatDate(inv.period_start)} to {formatDate(inv.period_end)}
              </p>
            )}
            {inv.paid_at && (
              <p>
                <span className="text-muted-foreground">Paid: </span>
                {formatDate(inv.paid_at)} by {inv.paid_method === "eft" ? "EFT" : "card"}
              </p>
            )}
          </div>
        </section>

        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Quantity</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.code}-${i}`} className="border-b border-border">
                <td className="py-2">{l.label}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right tabular-nums">{formatRandExact(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {inv.vat_registered && (
              <tr>
                <td className="pt-3 text-muted-foreground" colSpan={2}>
                  VAT included
                </td>
                <td className="pt-3 text-right tabular-nums text-muted-foreground">{formatRandExact(inv.vat_cents)}</td>
              </tr>
            )}
            <tr>
              <td className="pt-2 font-semibold" colSpan={2}>
                Total
              </td>
              <td className="pt-2 text-right font-semibold tabular-nums">{formatRandExact(inv.total_cents)}</td>
            </tr>
          </tfoot>
        </table>

        {credit && inv.reason && <p className="text-muted-foreground">Reason: {inv.reason}</p>}
        {!inv.vat_registered && <p className="text-xs text-muted-foreground">No VAT is charged: the seller is not registered for VAT.</p>}
      </article>
    </div>
  );
}
