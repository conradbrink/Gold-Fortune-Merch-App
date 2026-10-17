/**
 * Is this delivery one that is already in stock?
 *
 * GRN-000006 (OTP South Africa, keyed 15 Sep 2026) was the same 18 products
 * and the same quantities as GRN-000005, posted eleven days earlier, but keyed
 * in single items where the first was keyed in cases. It put one to three
 * extra items of each product into stock, which the 17 Oct stocktake found as
 * "an extra unit per thing". Nothing on the screen had said "you have
 * received this before".
 *
 * Two receipts look alike when they carry the same supplier invoice number, or
 * the same products with the same quantities typed (whatever the unit). One
 * product on its own is not enough: the same 200 of one flavour arrives every
 * month.
 *
 * Pure, so the rule can be tested without a browser.
 */

export type ReceiptForMatch = {
  id: string;
  grn_number: string;
  status: string;
  supplier_name: string | null;
  invoice_number: string | null;
  received_at: string | null;
  posted_at: string | null;
  lines: {
    product_id: string;
    qty_received: number;
    /** Single items into stock, when known. */
    base: number | null;
  }[];
};

export type LookAlike = {
  id: string;
  grn_number: string;
  /** When the other one was received, as stored. */
  received_at: string | null;
  sameInvoice: boolean;
  sameLines: boolean;
  /** Single items each put into stock, when both are known and they differ. */
  units: { theirs: number; ours: number } | null;
};

const norm = (v: string | null) => (v ?? "").trim().toLowerCase();

/** Product → quantity typed, summed over the lines of one receipt. */
function typed(r: ReceiptForMatch): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of r.lines) m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.qty_received);
  return m;
}

function totalBase(r: ReceiptForMatch): number | null {
  let n = 0;
  for (const l of r.lines) {
    if (l.base == null) return null;
    n += l.base;
  }
  return n;
}

export function receiptsLookAlike(ours: ReceiptForMatch, theirs: ReceiptForMatch): LookAlike | null {
  if (ours.id === theirs.id) return null;

  const sameInvoice =
    norm(ours.invoice_number) !== "" &&
    norm(ours.invoice_number) === norm(theirs.invoice_number) &&
    norm(ours.supplier_name) === norm(theirs.supplier_name);

  const a = typed(ours);
  const b = typed(theirs);
  const sameLines =
    a.size >= 2 && a.size === b.size && [...a].every(([product, qty]) => b.get(product) === qty);

  if (!sameInvoice && !sameLines) return null;

  const oursBase = totalBase(ours);
  const theirsBase = totalBase(theirs);
  return {
    id: theirs.id,
    grn_number: theirs.grn_number,
    received_at: theirs.received_at,
    sameInvoice,
    sameLines,
    units:
      oursBase != null && theirsBase != null && oursBase !== theirsBase
        ? { theirs: theirsBase, ours: oursBase }
        : null,
  };
}

/**
 * The posted receipt this one most looks like, or null.
 *
 * A draft is compared with every posted receipt; a posted one only with those
 * posted before it, so the first of a pair is never flagged as a copy of the
 * second.
 */
export function findLookAlike(
  ours: ReceiptForMatch,
  others: ReceiptForMatch[]
): LookAlike | null {
  const candidates = others.filter(
    (o) =>
      o.status === "posted" &&
      o.id !== ours.id &&
      (ours.status === "draft" ||
        (o.posted_at != null &&
          ours.posted_at != null &&
          // As instants: Postgres trims trailing zeros off fractional seconds,
          // so two timestamps do not compare correctly as text.
          Date.parse(o.posted_at) < Date.parse(ours.posted_at)))
  );
  let best: LookAlike | null = null;
  for (const o of candidates) {
    const m = receiptsLookAlike(ours, o);
    if (!m) continue;
    // Same lines beats a shared invoice number: it is the one that moved stock.
    if (!best || (m.sameLines && !best.sameLines)) best = m;
  }
  return best;
}

/** Single items a line puts into stock, as goods_receipt_post will work it out. */
export function lineBase(line: {
  uom: string;
  qty_received: number;
  units_per_uom: number | null;
  qty_base: number | null;
  units_per_shrink: number | null;
}): number | null {
  if (line.qty_base != null) return line.qty_base;
  if (line.units_per_uom != null) return line.qty_received * line.units_per_uom;
  if (line.uom === "each") return line.qty_received;
  if (line.uom === "shrink" && line.units_per_shrink) return line.qty_received * line.units_per_shrink;
  return null;
}
