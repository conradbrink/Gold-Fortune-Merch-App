import { fitBox, type LogoImage } from "@/lib/pdf-logo";
import { paperDate, paperMoney, sellerNumbers, type Paper, type PaperLine, type PdfSeller, type PdfSpec } from "@/lib/money-pdf";

/**
 * An invoice as an 80 mm till slip, for a company that prints at the counter
 * on a receipt printer (owner, 31 Oct: a client prints on an Epson TM-T20II).
 * The company chooses it in Settings > Business (`invoice_paper`); only the
 * Print button follows it, and the PDF and the emailed invoice stay A4.
 *
 * It is the same document as the A4 one (`lib/money-pdf.ts`), from the same
 * spec, laid out down a roll instead of across a page: the company's details
 * centred under its logo, the heading, the invoice's numbers and dates, who it
 * is for, each line with its quantity and price under its name, the totals,
 * whether it is paid, then the notes and how to pay.
 *
 * A thermal printer prints black dots only, so everything is black: no colour
 * bands, no grey text (it would print speckled). The page is 80 mm wide with
 * the content kept inside the 72 mm the printer can reach, so the slip comes
 * out whole whether the print box prints it at actual size or fits it to the
 * printable area. Each page is only as long as what is on it; a long invoice
 * goes on more than one page, none longer than the 297 mm roll page the
 * printer's driver offers first, so the print box never shrinks it to fit.
 */

type Doc = import("jspdf").jsPDF;

/** 80 mm in points, the slip's width. */
export const SLIP_WIDTH = (80 * 72) / 25.4;
/** 4.6 mm each side: what the printer cannot reach on an 80 mm roll, and a little more. */
const SIDE = 13;
const CONTENT = SLIP_WIDTH - 2 * SIDE;
const CENTRE = SLIP_WIDTH / 2;
const RIGHT = SLIP_WIDTH - SIDE;
/** The longest page, in points (275 mm): inside a 297 mm roll page and its driver's margins. */
export const SLIP_MAX_PAGE = 780;
const TOP = 12;
const BOTTOM = 20;
/** Room for "Page 1 of 2" at the foot of a slip that runs onto another page. */
const PAGE_LABEL = 14;

/** Something on the slip: how tall it is, and how to draw it from a top edge. */
type Block = { height: number; draw: (doc: Doc, top: number) => void };

const lineHeight = (size: number) => size * 1.28;

function font(doc: Doc, size: number, bold = false) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(0, 0, 0);
}

/** Text broken into lines that fit `width` at this size, each line of the original kept as its own. */
function split(m: Doc, text: string | null | undefined, size: number, bold: boolean, width = CONTENT): string[] {
  if (!text?.trim()) return [];
  font(m, size, bold);
  return text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .flatMap((part) => m.splitTextToSize(part, width) as string[]);
}

/** The y of a line's baseline, `i` lines below `top`. */
const baseline = (top: number, size: number, i: number) => top + i * lineHeight(size) + size * 0.92;

function paragraph(m: Doc, text: string | null | undefined, size: number, opts: { bold?: boolean; align?: "left" | "center" } = {}): Block | null {
  const bold = opts.bold ?? false;
  const lines = split(m, text, size, bold);
  if (lines.length === 0) return null;
  return {
    height: lines.length * lineHeight(size),
    draw: (doc, top) => {
      font(doc, size, bold);
      lines.forEach((line, i) =>
        opts.align === "center"
          ? doc.text(line, CENTRE, baseline(top, size, i), { align: "center" })
          : doc.text(line, SIDE, baseline(top, size, i))
      );
    },
  };
}

/** Text as one block a line, so a page can end between any two of its lines. */
function lineBlocks(m: Doc, text: string | null | undefined, size: number): Block[] {
  return split(m, text, size, false).map((line) => ({
    height: lineHeight(size),
    draw: (doc, top) => {
      font(doc, size);
      doc.text(line, SIDE, baseline(top, size, 0));
    },
  }));
}

/**
 * A label on the left and a value on the right, the label wrapping in what the
 * value leaves. A value too wide to share the line goes under the label.
 */
function row(m: Doc, label: string, value: string, size: number, opts: { bold?: boolean; strongValue?: boolean } = {}): Block {
  const labelBold = opts.bold ?? false;
  const valueBold = opts.strongValue ?? labelBold;
  font(m, size, valueBold);
  const valueWidth = m.getTextWidth(value);
  const shares = valueWidth <= CONTENT * 0.62;
  const labels = split(m, label, size, labelBold, shares ? CONTENT - valueWidth - 8 : CONTENT);
  const count = Math.max(labels.length, 1) + (shares ? 0 : 1);
  return {
    height: count * lineHeight(size),
    draw: (doc, top) => {
      font(doc, size, labelBold);
      labels.forEach((line, i) => doc.text(line, SIDE, baseline(top, size, i)));
      font(doc, size, valueBold);
      doc.text(value, RIGHT, baseline(top, size, shares ? 0 : count - 1), { align: "right" });
    },
  };
}

function gap(height: number): Block {
  return { height, draw: () => {} };
}

/** A rule across the slip: dashed between the parts, solid over the totals. */
function rule(dashed: boolean): Block {
  return {
    height: 11,
    draw: (doc, top) => {
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(dashed ? 0.6 : 0.9);
      if (dashed) doc.setLineDashPattern([2.5, 2], 0);
      doc.line(SIDE, top + 5.5, RIGHT, top + 5.5);
      if (dashed) doc.setLineDashPattern([], 0);
    },
  };
}

/** Several blocks kept on one page. */
function together(blocks: (Block | null)[]): Block | null {
  const parts = blocks.filter((b): b is Block => b !== null);
  if (parts.length === 0) return null;
  return {
    height: parts.reduce((sum, b) => sum + b.height, 0),
    draw: (doc, top) => {
      let y = top;
      for (const b of parts) {
        b.draw(doc, y);
        y += b.height;
      }
    },
  };
}

function logoBlock(logo: LogoImage | null): Block | null {
  if (!logo) return null;
  const box = fitBox(logo.width, logo.height, 150, 56);
  if (box.width === 0) return null;
  return {
    height: box.height + 8,
    draw: (doc, top) => doc.addImage(logo.dataUrl, logo.format ?? "PNG", CENTRE - box.width / 2, top, box.width, box.height),
  };
}

/** One line of goods: its name (and code), then the quantity at the price on the left and the amount on the right. */
function itemBlock(m: Doc, line: PaperLine): Block {
  const name = paragraph(m, [line.code, line.description].filter(Boolean).join("  "), 9);
  const priced = row(m, line.rate ? `${line.qty} x ${line.rate}` : line.qty, line.amount, 8.5, { strongValue: true });
  return together([name, priced, gap(4)])!;
}

/** A line given only as table cells (a document built before `items`): its cells in order. */
function cellsBlock(m: Doc, cells: string[]): Block {
  return together([paragraph(m, cells.filter((c) => c.trim() !== "").join("  "), 9), gap(4)])!;
}

/** The slip's content, top to bottom, measured on `m`. */
function slipBlocks(m: Doc, d: PdfSpec, logo: LogoImage | null): Block[] {
  const seller = d.seller;
  const header = together([
    logoBlock(logo),
    paragraph(m, seller.name, 11, { bold: true, align: "center" }),
    paragraph(m, seller.address, 8, { align: "center" }),
    paragraph(m, [seller.phone, seller.email].filter(Boolean).join("\n"), 8, { align: "center" }),
    paragraph(m, sellerNumbers(seller).join("\n"), 8, { align: "center" }),
    gap(8),
    paragraph(m, d.heading, 13, { bold: true, align: "center" }),
    gap(5),
  ]);

  const meta = together(d.meta.map(([label, value]) => row(m, label, value, 8.5, { strongValue: true })));

  const who = together([
    rule(true),
    paragraph(m, d.billTo.label ?? "Bill to", 8, { bold: true }),
    paragraph(m, d.billTo.name, 9.5, { bold: true }),
    paragraph(m, d.billTo.address, 8.5),
    paragraph(m, d.billTo.email, 8.5),
    d.shipTo?.address ? gap(4) : null,
    d.shipTo?.address ? paragraph(m, d.shipTo.label ?? "Ship to", 8, { bold: true }) : null,
    d.shipTo?.address ? paragraph(m, d.shipTo.address, 8.5) : null,
    rule(true),
  ]);

  // The heading over the lines stays on the page of the first line.
  const heading = together([row(m, "Item", "Amount", 8, { bold: true }), gap(3)])!;
  const items = d.items ? d.items.map((l) => itemBlock(m, l)) : d.rows.map((cells) => cellsBlock(m, cells));
  const lines = items.length ? [together([heading, items[0]])!, ...items.slice(1)] : [heading];

  // The totals, the amount to pay large, and whether it is paid, kept together.
  const totals = together([
    rule(false),
    ...d.totals.map(([label, value, strong], i) =>
      i === d.totals.length - 1 ? together([gap(2), row(m, label, value, 12, { bold: true })]) : row(m, label, value, 9, { bold: strong })
    ),
    d.status ? gap(7) : null,
    d.status ? paragraph(m, d.status.label.toUpperCase(), 11, { bold: true, align: "center" }) : null,
    // An invoice's detail is the date it is due; a statement's is an amount, printed as it is.
    d.status?.detail
      ? paragraph(m, /^\d{2}\/\d{2}\/\d{4}$/.test(d.status.detail) ? `Due date ${d.status.detail}` : d.status.detail, 8.5, { align: "center" })
      : null,
  ]);

  const ageing = d.ageing?.length
    ? together([rule(true), ...d.ageing.map(([label, value]) => row(m, label, value, 8.5))])
    : null;

  // Notes and bank details go line by line, so a long one runs onto the next page
  // instead of making a page too long; each heading stays with its first line.
  const notes = [...(d.notes ?? []), ...(d.footer ? [d.footer] : [])].filter((n) => n.trim() !== "");
  const after: (Block | null)[] = [];
  const titled = (title: string, body: Block[]) => {
    after.push(together([rule(true), paragraph(m, title, 8.5, { bold: true }), body[0] ?? null]), ...body.slice(1));
  };
  if (notes.length) titled(d.notesTitle ?? "Note to customer", notes.flatMap((note) => [...lineBlocks(m, note, 8), gap(3)]));
  if (d.payTo?.trim()) titled("How to pay", lineBlocks(m, d.payTo, 8));
  // A document's sign-off boxes (a delivery note's) are not printed on a slip: only invoices print on one.

  return [header, meta, who, ...lines, totals, ageing, ...after].filter((b): b is Block => b !== null);
}

type SlipPage = { blocks: Block[]; height: number; number: number; of: number };

/** The blocks onto pages no longer than SLIP_MAX_PAGE, each page as long as what is on it. */
export function paginate(blocks: { height: number }[]): { start: number; end: number; height: number }[] {
  const room = SLIP_MAX_PAGE - TOP - BOTTOM - PAGE_LABEL;
  const pages: { start: number; end: number; height: number }[] = [];
  let start = 0;
  let used = 0;
  blocks.forEach((b, i) => {
    if (i > start && used + b.height > room) {
      pages.push({ start, end: i, height: used });
      start = i;
      used = 0;
    }
    used += b.height;
  });
  if (blocks.length > 0) pages.push({ start, end: blocks.length, height: used });
  const label = pages.length > 1 ? PAGE_LABEL : 0;
  return pages.map((p) => ({ ...p, height: TOP + p.height + BOTTOM + label }));
}

function slipPages(m: Doc, d: PdfSpec, logo: LogoImage | null): SlipPage[] {
  const blocks = slipBlocks(m, d, logo);
  const pages = paginate(blocks);
  return pages.map((p, i) => ({ blocks: blocks.slice(p.start, p.end), height: p.height, number: i + 1, of: pages.length }));
}

/**
 * Invoices as till slips, one PDF: each starts on a page of its own, so the
 * printer cuts between them. Needs no browser: the tests draw from it.
 */
export async function buildTillSlips(docs: { spec: PdfSpec; logo: LogoImage | null }[]): Promise<Doc> {
  if (docs.length === 0) throw new Error("There is nothing to print.");
  const { jsPDF } = await import("jspdf");
  // Measured on a document of their own: the font and its sizes are the same, so the lines break the same.
  const measure = new jsPDF({ unit: "pt", format: [SLIP_WIDTH, SLIP_MAX_PAGE] });
  const pages = docs.flatMap(({ spec, logo }) => slipPages(measure, spec, logo));
  let doc: Doc | null = null;
  for (const page of pages) {
    // jsPDF turns a page wider than it is long on its side unless told it is landscape (a short last page).
    const orientation = page.height >= SLIP_WIDTH ? "portrait" : "landscape";
    const size: [number, number] = [SLIP_WIDTH, page.height];
    if (doc) doc.addPage(size, orientation);
    else doc = new jsPDF({ unit: "pt", format: size, orientation });
    let y = TOP;
    for (const b of page.blocks) {
      b.draw(doc, y);
      y += b.height;
    }
    if (page.of > 1) {
      font(doc, 7.5);
      doc.text(`Page ${page.number} of ${page.of}`, CENTRE, page.height - BOTTOM + 2, { align: "center" });
    }
  }
  return doc!;
}

/**
 * A slip to print while setting the printer up (Settings > Business): the
 * company's own letterhead over two made-up lines, headed so that nobody
 * takes it for an invoice.
 */
export function testSlipSpec(seller: PdfSeller, paper: Paper): PdfSpec {
  const fmt = paperMoney(paper);
  const items: PaperLine[] = [
    { code: "SAMPLE-1", description: "Sample product, 24 x 500ml", qty: "2", rate: fmt(140), amount: fmt(280) },
    { code: null, description: "Sample product with a long name to show how it wraps onto the next line", qty: "1", rate: fmt(14.9), amount: fmt(14.9) },
  ];
  return {
    heading: "TEST SLIP",
    fileName: "Test slip",
    seller,
    meta: [
      ["Invoice no.", "TEST"],
      ["Invoice date", paperDate(paper.today)],
    ],
    billTo: { label: "Bill to", name: "Sample customer", address: "1 Sample Street\nSample town" },
    head: ["Product or service", "Qty", "Rate", "Amount"],
    rows: items.map((l) => [l.description, l.qty, l.rate, l.amount]),
    items,
    numeric: [1, 2, 3],
    totals: [["Total", fmt(294.9)]],
    status: { label: "Paid", tone: "paid" },
    notes: ["This is a test. If the slip is whole and nothing is cut off at the sides, the printer is set up."],
  };
}
