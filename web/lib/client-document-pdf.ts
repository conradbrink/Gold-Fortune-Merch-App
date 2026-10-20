import { drawMoneyPdf, type Paper, type PdfSpec } from "@/lib/money-pdf";
import { invoicePdfSpec } from "@/lib/invoices";
import { quotePdfSpec } from "@/lib/quotes";
import { statementPdfSpec } from "@/lib/owed";
import { documentLook, todayIn, type DocumentView, type InvoiceView, type QuoteView, type StatementView } from "@/lib/client-document";

/**
 * The client's page as a PDF: the same drawer the signed-in screens use, fed
 * from what the page was given, in the company's look. The client has no login,
 * so nothing here reads a company setting.
 */

/** The page's currency, and today on the company's clock (or the day given). */
function paperOf(v: DocumentView, today?: string): Paper {
  return { currency: v.look.currency, today: today ?? todayIn(v.timezone) };
}

/** The invoice, then what has been taken off it, what is still to pay, and whether it is overdue. */
export function invoiceViewPdfSpec(v: InvoiceView, today?: string): PdfSpec {
  const spec = invoicePdfSpec(
    { invoice: v.invoice, lines: v.lines, visits: [], balance: { credited: v.credited, paid: v.paid, outstanding: v.outstanding } },
    paperOf(v, today)
  );
  return { ...spec, look: documentLook(v.look) };
}

export function quoteViewPdfSpec(v: QuoteView, today?: string): PdfSpec {
  const c = v.company;
  const spec = quotePdfSpec(
    {
      // The page's own wording of who it is for: the name and address the database settled on.
      quote: { ...v.quote, customer_address: v.customer_address, delivery_address: null },
      storeName: v.customer_name,
      storeAddress: null,
      lines: v.lines.map((l) => ({ label: l.description, brand: null, sku: l.sku, unit: l.unit, qty: l.qty, unit_price: l.unit_price })),
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
    },
    paperOf(v, today)
  );
  return { ...spec, look: documentLook(v.look) };
}

export function statementViewPdfSpec(v: StatementView, today?: string): PdfSpec {
  const c = v.company;
  const s = v.statement;
  const paper = paperOf(v, today);
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
    s.rows,
    paper,
    s.ageing
  );
  return { ...spec, look: documentLook(v.look) };
}

export function documentPdfSpec(v: DocumentView, today?: string): PdfSpec {
  return v.kind === "invoice" ? invoiceViewPdfSpec(v, today) : v.kind === "quote" ? quoteViewPdfSpec(v, today) : statementViewPdfSpec(v, today);
}

export async function downloadDocumentPdf(v: DocumentView) {
  await drawMoneyPdf(documentPdfSpec(v));
}
