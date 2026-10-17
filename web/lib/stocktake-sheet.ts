import type { ExportColumn, ExportSheet } from "@/lib/export";

/**
 * A stocktake as a printable sheet and an Excel file.
 *
 * Two shapes, because a count has two lives. While it is being counted the
 * sheet is the one a counter carries round the warehouse: what the system
 * says, how many of those are packed for orders, and an empty Counted column
 * to write in. Once it is handed in it is the record: every count, any
 * recount, the difference and why. Either way the top says who counted it and
 * when, and who approved it.
 *
 * Pure, so the rules can be tested without a browser.
 */

export type SheetLine = {
  id: string;
  product_name: string;
  brand: string | null;
  system_qty_at_open: number;
  counted_qty: number | null;
  recount_qty: number | null;
  variance_reason: string | null;
};

export type SheetVariance = {
  line_id: string;
  product_name: string;
  batch_number: string | null;
  system_qty_at_open: number;
  counted_qty: number | null;
  system_qty_at_submit: number | null;
  variance_qty: number | null;
  variance_reason: string | null;
};

export type SheetInput = {
  stocktake: {
    stocktake_number: string;
    stocktake_type: string;
    status: string;
    started_at: string | null;
    submitted_at: string | null;
    decided_at: string | null;
    decision_note: string | null;
    notes?: string | null;
  };
  locationName: string | null;
  people: { startedBy: string | null; submittedBy: string | null; decidedBy: string | null };
  lines: SheetLine[];
  variance: SheetVariance[];
  /** Packed or set aside for orders now, by line id. */
  setAside: Record<string, number>;
};

/** "17 Oct 2026, 12:09" in the reader's own time. */
export function stampWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const reason = (r: string | null) => (r ? r.replace(/_/g, " ") : "");

/** "Started by Conrad Brink on 16 Oct 2026, 15:17", one per step that happened. */
export function whoAndWhen(input: Pick<SheetInput, "stocktake" | "people">): string[] {
  const { stocktake: s, people: p } = input;
  const step = (verb: string, who: string | null, when: string | null) =>
    when ? `${verb}${who ? ` by ${who}` : ""} on ${stampWhen(when)}` : null;
  return [
    step("Started", p.startedBy, s.started_at),
    step("Handed in", p.submittedBy, s.submitted_at),
    s.status === "approved" || s.status === "rejected"
      ? step(s.status === "approved" ? "Approved" : "Rejected", p.decidedBy, s.decided_at)
      : null,
  ].filter((x): x is string => x !== null);
}

export function stocktakeSheet(input: SheetInput): ExportSheet {
  const { stocktake: s } = input;
  const counting = s.status === "counting" || s.status === "draft";
  const context = [
    [input.locationName, `${s.stocktake_type} count`, s.status].filter(Boolean).join(" · "),
    ...whoAndWhen(input),
    ...(s.notes ? [`Note: ${s.notes}`] : []),
    ...(s.decision_note ? [`${s.status === "rejected" ? "Rejected" : "Approved"}: ${s.decision_note}`] : []),
  ];

  if (counting) {
    const columns: ExportColumn[] = [
      { header: "Product", key: "product" },
      { header: "System says", key: "system", numeric: true },
      { header: "Of which packed for orders", key: "packed", numeric: true },
      { header: "Counted", key: "counted", numeric: true },
      { header: "If different, why?", key: "reason" },
    ];
    return {
      title: `Stocktake ${s.stocktake_number}`,
      context: [
        ...context,
        "Count every single item at this location, including boxes packed for orders that have not left.",
      ],
      columns,
      rows: input.lines.map((l) => ({
        product: l.brand ? `${l.product_name} (${l.brand})` : l.product_name,
        system: l.system_qty_at_open,
        packed: input.setAside[l.id] || null,
        counted: l.counted_qty,
        reason: reason(l.variance_reason),
      })),
      filename: `stocktake-${s.stocktake_number}`,
    };
  }

  const recountById = new Map(input.lines.map((l) => [l.id, l.recount_qty]));
  const withBatch = input.variance.some((v) => v.batch_number);
  const over = input.variance.reduce((n, v) => n + Math.max(v.variance_qty ?? 0, 0), 0);
  const short = input.variance.reduce((n, v) => n + Math.max(-(v.variance_qty ?? 0), 0), 0);
  const differing = input.variance.filter((v) => (v.variance_qty ?? 0) !== 0).length;

  const columns: ExportColumn[] = [
    { header: "Product", key: "product" },
    ...(withBatch ? [{ header: "Batch", key: "batch" }] : []),
    { header: "System at start", key: "open", numeric: true },
    { header: "Counted", key: "counted", numeric: true },
    { header: "Recounted", key: "recount", numeric: true },
    { header: "System at hand-in", key: "submit", numeric: true },
    { header: "Difference", key: "variance", numeric: true },
    { header: "Reason", key: "reason" },
  ];
  return {
    title: `Stocktake ${s.stocktake_number}`,
    context: [
      ...context,
      `${input.variance.length} lines counted · ${differing} with a difference · ${over} over · ${short} short`,
    ],
    columns,
    rows: input.variance.map((v) => ({
      product: v.product_name,
      batch: v.batch_number ?? "",
      open: v.system_qty_at_open,
      counted: v.counted_qty,
      recount: recountById.get(v.line_id) ?? null,
      submit: v.system_qty_at_submit,
      variance: v.variance_qty,
      reason: reason(v.variance_reason),
    })),
    filename: `stocktake-${s.stocktake_number}`,
  };
}
