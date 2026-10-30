/**
 * Tickd's invoices, credit notes and payments as Sage wants them. Pure: the
 * sync looks up the Sage ids (customer, items, tax type, bank account) first
 * and passes them in.
 *
 * Tickd keeps one VAT rate per invoice, with the line prices either before
 * VAT or including it (`prices_include_vat`); Sage gets the same basis
 * (`Inclusive`) and the line prices as they are, and works out its own
 * totals. Tickd's number goes in as the document number
 * (`useSystemDocumentNumber=false`) and Tickd's id as the external
 * reference, so a document can be found again after a lost answer.
 */

export type InvoiceLine = {
  id: string;
  position: number;
  product_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  line_total: number;
  unit: string | null;
};

export type Invoice = {
  id: string;
  invoice_number: string;
  status: string;
  store_id: string | null;
  customer_name: string;
  customer_address: string | null;
  customer_email: string | null;
  issue_date: string;
  due_date: string;
  vat_rate: number;
  prices_include_vat: boolean;
  subtotal: number;
  total: number;
  reference: string | null;
  customer_po_number: string | null;
  lines: InvoiceLine[];
};

export type CreditNoteLine = { invoice_line_id: string | null; qty: number; unit_price: number; line_total: number };

export type CreditNote = {
  id: string;
  credit_number: string;
  invoice_id: string;
  reason: string | null;
  issue_date: string;
  subtotal: number;
  total: number;
  lines: CreditNoteLine[];
};

export type Payment = {
  id: string;
  invoice_id: string;
  amount: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
};

export type Customer = {
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
};

/** Sage's item and tax type for one line, found by the sync. */
export type LineIds = { itemId: number; taxTypeId: number | null };

const cut = (value: string | null | undefined, max: number) => {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  return v.length > max ? v.slice(0, max) : v;
};

const money = (n: number) => Math.round(Number(n) * 100) / 100;

/** A date column as Sage's yyyy-MM-dd. */
export function sageDate(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "");
  if (!m) throw new Error(`Not a date: ${value}`);
  return m[1];
}

/** An address as Sage's five lines of up to 100 characters: its parts, then the town and code. */
export function addressLines(address: string | null, city?: string | null, zip?: string | null): string[] {
  const parts = (address ?? "")
    .split(/[\n,]+/)
    .map((p) => cut(p, 100))
    .filter(Boolean);
  const tail = [cut(city, 100), cut(zip, 100)].filter(
    (p) => p && !parts.some((x) => x.toLowerCase() === p.toLowerCase()),
  );
  // Keep the town and code; fold any street parts beyond the room left into one line.
  const room = 5 - tail.length;
  const street = parts.length > room ? [...parts.slice(0, room - 1), cut(parts.slice(room - 1).join(", "), 100)] : parts;
  return [...street, ...tail];
}

function addressFields(prefix: "PostalAddress" | "DeliveryAddress", lines: string[]) {
  const out: Record<string, string> = {};
  lines.slice(0, 5).forEach((line, i) => {
    out[`${prefix}0${i + 1}`] = line;
  });
  return out;
}

/** A new Sage customer for a Tickd customer. */
export function customerBody(c: Customer): Record<string, string | boolean> {
  const lines = addressLines(c.address, c.city, c.zip);
  const phone = cut(c.phone, 30);
  return {
    Name: cut(c.name, 100),
    Active: true,
    ...(c.contact_name ? { ContactName: cut(c.contact_name, 100) } : {}),
    ...(c.email ? { Email: cut(c.email, 254), AcceptsElectronicInvoices: true } : {}),
    ...(phone ? (/^\+?27[6-8]|^0[6-8]/.test(phone.replace(/\s/g, "")) ? { Mobile: phone } : { Telephone: phone }) : {}),
    ...addressFields("PostalAddress", lines),
    ...addressFields("DeliveryAddress", lines),
  };
}

/** A new Sage item for a Tickd product (a service item: Sage's stock is not Tickd's to move). */
export function itemBody(code: string, name: string, taxTypeId: number | null) {
  return {
    Code: cut(code, 100),
    Description: cut(name, 100) || cut(code, 100),
    Active: true,
    Physical: false,
    ...(taxTypeId ? { TaxTypeIdSales: taxTypeId } : {}),
  };
}

/** Sage's item for lines with no product of their own. */
export const GENERIC_ITEM = { code: "TICKD", name: "Sold through Tickd" };

export type SageLine = {
  SelectionId: number;
  LineType: number;
  Description: string;
  Quantity: number;
  UnitPriceExclusive?: number;
  UnitPriceInclusive?: number;
  TaxTypeId?: number;
  Unit?: string;
  DiscountPercentage: number;
};

function lineBody(
  description: string,
  qty: number,
  price: number,
  inclusive: boolean,
  ids: LineIds,
  unit?: string | null,
): SageLine {
  return {
    SelectionId: ids.itemId,
    LineType: 0,
    Description: cut(description, 100) || "Item",
    Quantity: qty,
    ...(inclusive ? { UnitPriceInclusive: price } : { UnitPriceExclusive: price }),
    ...(ids.taxTypeId ? { TaxTypeId: ids.taxTypeId } : {}),
    ...(unit ? { Unit: cut(unit, 20) } : {}),
    DiscountPercentage: 0,
  };
}

export function invoiceBody(inv: Invoice, customerId: number, ids: (line: InvoiceLine) => LineIds) {
  const reference = inv.customer_po_number || inv.reference;
  return {
    CustomerId: customerId,
    CustomerName: cut(inv.customer_name, 100),
    Date: sageDate(inv.issue_date),
    DueDate: sageDate(inv.due_date),
    DocumentNumber: cut(inv.invoice_number, 100),
    ExternalReference: inv.id,
    ...(reference ? { Reference: cut(reference, 100) } : {}),
    Inclusive: inv.prices_include_vat,
    DiscountPercentage: 0,
    ...addressFields("PostalAddress", addressLines(inv.customer_address)),
    Lines: [...inv.lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => lineBody(l.description, Number(l.qty), money(l.unit_price), inv.prices_include_vat, ids(l), l.unit)),
  };
}

/**
 * A credit note as a Sage customer return. Its lines are the invoice lines it
 * takes back; a rebate (no lines) is one line for its whole amount.
 */
export function returnBody(
  cn: CreditNote,
  inv: Invoice,
  customerId: number,
  ids: (line: InvoiceLine | null) => LineIds,
) {
  const byId = new Map(inv.lines.map((l) => [l.id, l]));
  const lines =
    cn.lines.length > 0
      ? cn.lines.map((cl) => {
          const il = cl.invoice_line_id ? (byId.get(cl.invoice_line_id) ?? null) : null;
          return lineBody(il?.description ?? cn.reason ?? "Credit", Number(cl.qty), money(cl.unit_price),
                          inv.prices_include_vat, ids(il), il?.unit);
        })
      : [lineBody(cn.reason ?? "Credit", 1, money(inv.prices_include_vat ? cn.total : cn.subtotal),
                  inv.prices_include_vat, ids(null))];
  return {
    CustomerId: customerId,
    CustomerName: cut(inv.customer_name, 100),
    Date: sageDate(cn.issue_date),
    DocumentNumber: cut(cn.credit_number, 100),
    ExternalReference: cn.id,
    Reference: cut(inv.invoice_number, 100),
    ...(cn.reason ? { Message: cut(cn.reason, 8000) } : {}),
    Inclusive: inv.prices_include_vat,
    DiscountPercentage: 0,
    Lines: lines,
  };
}

/** Sage's receipt payment methods. */
export const PAYMENT_METHOD: Record<string, number> = { cash: 1, cheque: 2, card: 3, eft: 4, other: 4 };

export function receiptBody(p: Payment, inv: Invoice, customerId: number, bankAccountId: number) {
  return {
    CustomerId: customerId,
    Date: sageDate(p.paid_on),
    Total: money(p.amount),
    BankAccountId: bankAccountId,
    PaymentMethod: PAYMENT_METHOD[p.method ?? ""] ?? PAYMENT_METHOD.eft,
    Reference: cut(p.reference || inv.invoice_number, 100),
    Description: cut(`Payment on ${inv.invoice_number}`, 100),
  };
}

export function allocationBody(sourceId: number, invoiceId: number, total: number) {
  return { SourceDocumentId: sourceId, AllocatedToDocumentId: invoiceId, Total: money(total), Discount: 0 };
}
