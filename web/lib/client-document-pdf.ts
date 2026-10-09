import { drawMoneyPdf, money, type PdfSpec } from "@/lib/money-pdf";
import { invoicePdfSpec } from "@/lib/invoices";
import { quotePdfSpec } from "@/lib/quotes";
import { statementPdfSpec } from "@/lib/owed";
import { ageingParts, documentLook, type DocumentView, type InvoiceView, type QuoteView, type StatementView } from "@/lib/client-document";

/**
 * The client's page as a PDF: the same drawer the signed-in screens use, fed
 * from what the page was given, in the company's look. The client has no login,
 * so nothing here reads a company setting.
 */

/** The invoice, then what has been taken off it and what is still to pay. */
export function invoiceViewPdfSpec(v: InvoiceView): PdfSpec {
  const spec = invoicePdfSpec({ invoice: v.invoice, lines: v.lines, visits: [] });
  const totals = [...spec.totals];
  if (v.credited > 0 || v.paid > 0) {
    if (v.credited > 0) totals.push(["Credit notes", `-${money(v.credited)}`]);
    if (v.paid > 0) totals.push(["Paid", `-${money(v.paid)}`]);
    totals.push(["Amount due", money(v.outstanding)]);
  }
  return { ...spec, totals, look: documentLook(v.look) };
}

export function quoteViewPdfSpec(v: QuoteView): PdfSpec {
  const c = v.company;
  const spec = quotePdfSpec(
    {
      // The page's own wording of who it is for: the name and address the database settled on.
      quote: { ...v.quote, customer_address: v.customer_address, delivery_address: null },
      storeName: v.customer_name,
      storeAddress: null,
      lines: v.lines.map((l) => ({ label: l.description, brand: null, unit: l.unit, qty: l.qty, unit_price: l.unit_price })),
    },
    {
      name: c.name,
      legal_name: null,
      address: c.address,
      tax_number: c.tax_number,
      vat_number: c.vat_number,
      registration_number: c.registration_number,
      phone: c.phone,
      support_email: c.email,
      logo_path: c.logo_path,
      bank_details: c.bank_details,
    }
  );
  return { ...spec, look: documentLook(v.look) };
}

export function statementViewPdfSpec(v: StatementView): PdfSpec {
  const c = v.company;
  const s = v.statement;
  const spec = statementPdfSpec(
    {
      name: c.name,
      legal_name: null,
      address: c.address,
      tax_number: c.tax_number,
      vat_number: c.vat_number,
      registration_number: c.registration_number,
      phone: c.phone,
      support_email: c.email,
      logo_path: c.logo_path,
      bank_details: c.bank_details,
    },
    { storeId: null, name: s.client_name, address: s.client_address },
    s.from,
    s.to,
    s.rows
  );
  const owing = ageingParts(s.ageing);
  const notes = owing.length ? [`What is owed at ${s.to}: ${owing.map((p) => `${p.label} ${money(p.amount)}`).join(", ")}.`] : [];
  return { ...spec, notes, look: documentLook(v.look) };
}

export function documentPdfSpec(v: DocumentView): PdfSpec {
  return v.kind === "invoice" ? invoiceViewPdfSpec(v) : v.kind === "quote" ? quoteViewPdfSpec(v) : statementViewPdfSpec(v);
}

export async function downloadDocumentPdf(v: DocumentView) {
  await drawMoneyPdf(documentPdfSpec(v));
}
