import { logoUrl } from "@/lib/branding";
import { fitBox, loadLogoImage, type LogoImage } from "@/lib/pdf-logo";
import { brandText, hexToRgb, mix, readableOn, tint, wash, type PdfLook, type Rgb } from "@/lib/document-style";
import { amountText, daysBetween } from "@/lib/client-document";

/**
 * One letterhead for every money document (invoice, credit note, quote and
 * statement) so they read as one company's paperwork. The warehouse's picking
 * list and delivery note are drawn on it too (`lib/order-paper.ts`): no
 * prices, a box to tick per line or boxes to sign at the foot.
 *
 * The layout is the owner's choice (20 Oct), modelled on the QuickBooks
 * invoice their clients already know: the heading and the company's details
 * at the top; who it is for and the document's numbers and dates; the lines,
 * numbered; then a note to the customer on the left and the totals on the
 * right, ending with whether it is paid. The company's look (`document_style`)
 * dresses that one layout three ways:
 *
 * - `classic`, the owner's sample: the logo on the right, a light band of the
 *   brand colour behind who it is for, plain lines with thin rules;
 * - `bold`: the heading and the logo in a band of the brand colour, the
 *   table's heading in it too, and the amount due on a block of it;
 * - `clean`: the letterhead centred over a thin rule of the brand colour, no
 *   fills, and the amount due large in the brand colour.
 *
 * A document passes what it has; empty fields are left out rather than
 * printed blank.
 */

/**
 * Amounts in one fixed form, "1,500.00". With the viewer's locale the same
 * invoice printed "1 500,00" from a South African browser (a no-break space
 * the PDF font may not draw), "1,500.00" from a US one, and the emailed copy,
 * drawn on the server, differed again. Matches `amountText` on the client's
 * page and in the emails.
 */
export const money = (n: number) =>
  Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What a document's words depend on beyond the document: the company's currency, and today on its clock. */
export type Paper = { currency: string | null; today: string };

/**
 * An amount on paper: "P1,500.00" in the company's currency. The PDF's
 * built-in font draws Latin-1 only, so a symbol it cannot draw ("₦", "₹") is
 * written as the code after the number instead.
 */
export const paperMoney = (paper: Paper) => (n: number) => {
  const text = amountText(n, paper.currency);
  return /[^\x20-\xFF€]/.test(text) ? `${amountText(n, null)} ${paper.currency}` : text;
};

/** A date as the paper prints it: "21/08/2026". A value that is not a date is printed as it came. */
export function paperDate(day: string | null | undefined): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (day ?? "");
}

/**
 * The payment terms, from the days between the invoice and its due date:
 * "Net 30", or "Due on receipt".
 */
export function termsText(issued: string, due: string): string {
  const days = daysBetween(issued, due);
  if (!Number.isFinite(days)) return "";
  return days <= 0 ? "Due on receipt" : `Net ${days}`;
}

/**
 * The rows above the total: the VAT, and what it was worked out on. Prices
 * that include VAT say so in one row, as the client paid one price; prices
 * before VAT show the subtotal first.
 */
export function vatRows(
  rate: number,
  pricesIncludeVat: boolean,
  subtotal: number,
  vat: number,
  fmt: (n: number) => string
): [string, string][] {
  if (!(rate > 0)) return [];
  const on = `VAT @ ${Number(rate.toFixed(2))}% on ${fmt(subtotal)}`;
  if (pricesIncludeVat) return [[`Includes ${on}`, fmt(vat)]];
  return [
    ["Subtotal", fmt(subtotal)],
    [on, fmt(vat)],
  ];
}

/** A line of goods or work as the paper prints it, amounts already written out. */
export type PaperLine = { code?: string | null; description: string; qty: string; rate: string; amount: string };

/**
 * The lines' columns: numbered, a product code in bold only when a line has
 * one (then the description beside it), and "VAT" against each line when VAT
 * is charged.
 */
export function paperLines(lines: PaperLine[], taxed: boolean): Pick<PdfSpec, "head" | "rows" | "numeric" | "strong" | "numbered"> {
  const coded = lines.some((l) => l.code);
  const first = coded ? 2 : 1;
  return {
    head: ["Product or service", ...(coded ? ["Description"] : []), "Qty", "Rate", "Amount", ...(taxed ? ["Tax"] : [])],
    rows: lines.map((l) => [
      ...(coded ? [l.code ?? "", l.description] : [l.description]),
      l.qty,
      l.rate,
      l.amount,
      ...(taxed ? ["VAT"] : []),
    ]),
    numeric: [first, first + 1, first + 2, ...(taxed ? [first + 3] : [])],
    strong: coded ? [0] : [],
    numbered: true,
  };
}

/** The last line of a document: whether it is paid, with the due date or the amount beside it. */
export type PdfStatus = { label: string; tone: "overdue" | "due" | "paid" | "void"; detail?: string | null };

/** An invoice's state on the day it is printed: void, paid, overdue, or due on its date. */
export function invoiceStatus(
  inv: { status: string; due_date: string },
  balance: { outstanding: number; paid: number; credited?: number },
  today: string
): PdfStatus {
  if (inv.status === "void") return { label: "Void", tone: "void" };
  const left = Math.round(Number(balance.outstanding) * 100) / 100;
  if (left <= 0) {
    const label = Number(balance.paid) > 0 ? "Paid" : Number(balance.credited ?? 0) > 0 ? "Fully credited" : "Nothing to pay";
    return { label, tone: "paid" };
  }
  const late = inv.due_date.slice(0, 10) < today.slice(0, 10);
  return { label: late ? "Overdue" : "Due", tone: late ? "overdue" : "due", detail: paperDate(inv.due_date) };
}

/**
 * A statement's last line: what is overdue (beside it, how much), or that
 * nothing is yet, or that nothing is owed. Without the ageing, only the last.
 */
export function statementStatus(closing: number, overdue: number | null, fmt: (n: number) => string): PdfStatus | null {
  const left = Math.round(closing * 100) / 100;
  if (left < 0) return { label: "In credit", tone: "paid", detail: fmt(-left) };
  if (left === 0) return { label: "Nothing to pay", tone: "paid" };
  if (overdue === null) return null;
  // The ageing is as of the statement's last day; money on account can leave less owed than is overdue.
  const late = Math.min(Math.round(overdue * 100) / 100, left);
  return late > 0.004 ? { label: "Overdue", tone: "overdue", detail: fmt(late) } : { label: "Not yet due", tone: "due" };
}

/**
 * Boxes at the end of a document for people to fill in by hand: who received
 * the goods, who picked them. A heading, a sentence saying what signing means,
 * then rows of boxes, each labelled in its top corner.
 */
export type SignOff = {
  title: string;
  text?: string | null;
  /** Each row's height in points, and its boxes left to right; a box's share of the row is relative to the others'. */
  rows: { height: number; boxes: { label: string; share?: number }[] }[];
};

export type PdfSeller = {
  name: string;
  address?: string | null;
  taxNumber?: string | null;
  vatNumber?: string | null;
  registrationNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Storage path of the logo, as stored (on the document, or the company's current one). */
  logoPath?: string | null;
};

export type PdfSpec = {
  heading: string;
  fileName: string;
  seller: PdfSeller;
  /** The heading over `meta` in the band: "Invoice details". */
  metaTitle?: string;
  /** The document's numbers and dates, printed "Invoice no.: 1615". */
  meta: [string, string][];
  billTo: { label?: string; name: string; address?: string | null; email?: string | null };
  /** Where the goods go, beside who pays, when that is somewhere else. */
  shipTo?: { label?: string; address: string } | null;
  head: string[];
  rows: string[][];
  /** Column indexes printed right-aligned (numbers). */
  numeric: number[];
  /** Column indexes printed in bold (a product code). */
  strong?: number[];
  /** Number the lines "1.", "2.", in a narrow column of their own. */
  numbered?: boolean;
  /** Column indexes printed as an empty box, to tick or write in by hand (a picking list's "Picked"). */
  boxes?: number[];
  /**
   * The amounts under the lines; the last is the one to pay, in large type.
   * A row marked strong (the total, when payments follow it) is in bold over a rule.
   */
  totals: [label: string, value: string, strong?: boolean][];
  /** Under the total: paid, overdue, due on a date, or void. */
  status?: PdfStatus | null;
  /** A statement's ageing, in a strip of its own under the lines: label, amount. */
  ageing?: [string, string][] | null;
  /** Paragraphs for the customer: a void reason, a credit's reason, terms. */
  notes?: string[];
  /** The heading over the notes; "Note to customer" unless the document is for someone else. */
  notesTitle?: string;
  /** "How to pay": bank details, printed under a heading of their own. */
  payTo?: string | null;
  footer?: string | null;
  /** Boxes to sign at the foot of the last page. */
  signOff?: SignOff | null;
  /** The look to draw in; without one, the company's own is read. */
  look?: PdfLook;
};

const MARGIN = 36;
const INK: Rgb = [33, 33, 33];
const SOFT: Rgb = [84, 84, 84];
const RULE: Rgb = [218, 218, 218];
/** The edge of a box to fill in by hand: dark enough to survive a cheap printer and a photocopy. */
const BOX: Rgb = [120, 120, 120];
const WHITE: Rgb = [255, 255, 255];
const TONES: Record<PdfStatus["tone"], Rgb> = {
  overdue: [196, 78, 8],
  due: INK,
  paid: [22, 122, 58],
  void: [184, 28, 28],
};

type Doc = import("jspdf").jsPDF;
type Ctx = {
  doc: Doc;
  d: PdfSpec;
  logo: LogoImage | null;
  look: PdfLook;
  /** The brand colour as it is, for fills. */
  primary: Rgb;
  /** The brand colour as small text on white and on its band. */
  brand: Rgb;
  /** The light band of the brand colour. */
  band: Rgb;
  left: number;
  right: number;
  width: number;
};

const set = (fn: (r: number, g: number, b: number) => void, c: Rgb) => fn(c[0], c[1], c[2]);
const wrap = (doc: Doc, text: string | null | undefined, width: number) =>
  text ? (doc.splitTextToSize(text.trim(), width) as string[]) : [];
const fillWith = (doc: Doc, c: Rgb) => set(doc.setFillColor.bind(doc), c);
const textIn = (doc: Doc, c: Rgb) => set(doc.setTextColor.bind(doc), c);
const lineIn = (doc: Doc, c: Rgb, width: number) => {
  set(doc.setDrawColor.bind(doc), c);
  doc.setLineWidth(width);
};

/** The company's VAT, tax and registration numbers, as printed. */
function sellerNumbers(s: PdfSeller): string[] {
  return [
    s.vatNumber && `VAT no: ${s.vatNumber}`,
    s.taxNumber && `TIN: ${s.taxNumber}`,
    s.registrationNumber && `Reg no: ${s.registrationNumber}`,
  ].filter(Boolean) as string[];
}

const contactLines = (s: PdfSeller) => [s.email, s.phone].filter(Boolean) as string[];

/** The company's name, address and numbers at (x, y), and how to reach it in a column beside them. Returns the y below. */
function sellerBlock(c: Ctx, x: number, y: number, withName: boolean): number {
  const { doc, d } = c;
  const column = 175;
  let sy = y;
  if (withName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    textIn(doc, INK);
    for (const line of wrap(doc, d.seller.name, column)) {
      doc.text(line, x, sy);
      sy += 11.5;
    }
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  textIn(doc, SOFT);
  const lines = [...wrap(doc, d.seller.address, column), ...sellerNumbers(d.seller).flatMap((n) => wrap(doc, n, column))];
  for (const line of lines) {
    doc.text(line, x, sy);
    sy += 11;
  }
  let cy = y;
  for (const line of contactLines(d.seller)) {
    doc.text(line, x + column + 24, cy);
    cy += 11;
  }
  return Math.max(sy, cy);
}

// ----------------------------------------------------------------- headers

/** Classic, the owner's sample: the heading in the brand colour over the company's details, the logo on the right. */
function headerClassic(c: Ctx): number {
  const { doc, d, logo, brand, left, right } = c;
  let logoBottom = 0;
  if (logo) {
    const box = fitBox(logo.width, logo.height, 130, 74);
    doc.addImage(logo.dataUrl, logo.format ?? "PNG", right - box.width, 30, box.width, box.height);
    logoBottom = 30 + box.height;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  textIn(doc, brand);
  doc.setCharSpace(0.8);
  doc.text(d.heading, left, 46);
  doc.setCharSpace(0);
  return Math.max(sellerBlock(c, left, 64, true), logoBottom + 8) + 18;
}

/** Bold: the logo on a white plate and the heading, in a band of the brand colour; the company's details under it. */
function headerBold(c: Ctx): number {
  const { doc, d, logo, look, primary, left, right, width } = c;
  const on = readableOn(primary);
  const height = 92;
  fillWith(doc, primary);
  doc.rect(0, 0, width, height, "F");
  fillWith(doc, hexToRgb(look.accent));
  doc.rect(0, height, width, 3, "F");
  if (logo) {
    const box = fitBox(logo.width, logo.height, 140, 46);
    fillWith(doc, WHITE);
    doc.roundedRect(left, (height - box.height) / 2 - 8, box.width + 16, box.height + 16, 5, 5, "F");
    doc.addImage(logo.dataUrl, logo.format ?? "PNG", left + 8, (height - box.height) / 2, box.width, box.height);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    textIn(doc, on);
    let name = wrap(doc, d.seller.name, 280);
    if (name.length > 2) {
      doc.setFontSize(11);
      name = wrap(doc, d.seller.name, 280).slice(0, 4);
    }
    doc.text(name, left, name.length > 2 ? 30 : 44);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  textIn(doc, on);
  doc.setCharSpace(0.6);
  doc.text(d.heading, right, height / 2 + 7, { align: "right" });
  doc.setCharSpace(0);
  // Without a logo the name is already in the band.
  return sellerBlock(c, left, height + 3 + 26, !!logo) + 18;
}

/** Clean: the logo, name and details centred, a thin rule of the brand colour, then the heading spaced out. */
function headerClean(c: Ctx): number {
  const { doc, d, logo, brand, left, right, width } = c;
  let y = 36;
  if (logo) {
    const box = fitBox(logo.width, logo.height, 150, 54);
    doc.addImage(logo.dataUrl, logo.format ?? "PNG", (width - box.width) / 2, y, box.width, box.height);
    y += box.height + 16;
  } else {
    y += 8;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  textIn(doc, INK);
  for (const line of wrap(doc, d.seller.name, 420)) {
    doc.text(line, width / 2, y, { align: "center" });
    y += 14;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  textIn(doc, SOFT);
  const flat = (t: string) => t.split(/\s*\n\s*/).filter(Boolean).join(", ");
  const numbers = sellerNumbers(d.seller);
  const contact = contactLines(d.seller);
  const lines = [
    ...(d.seller.address ? wrap(doc, flat(d.seller.address), 380) : []),
    ...(numbers.length ? [numbers.join("   ·   ")] : []),
    ...(contact.length ? [contact.join("   ·   ")] : []),
  ];
  lines.forEach((line, i) => doc.text(line, width / 2, y + i * 11, { align: "center" }));
  y += lines.length * 11 + 8;
  lineIn(doc, brand, 1.2);
  doc.line(left, y, right, y);
  y += 34;
  textIn(doc, brand);
  doc.setFontSize(18);
  doc.setCharSpace(3);
  doc.text(d.heading, left, y);
  doc.setCharSpace(0);
  return y + 4;
}

// -------------------------------------------------------------------- band

/**
 * Who it is for, where it goes, and the document's numbers: on a light band
 * of the brand colour (classic and bold), or on the paper itself (clean).
 * Returns the y below it.
 */
function drawBand(c: Ctx, top: number): number {
  const { doc, d, brand, band, look, left, right, width } = c;
  const filled = look.style !== "clean";
  const split = left + (right - left) * 0.55;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const name = wrap(doc, d.billTo.name, split - left - 20);
  const bill = [...wrap(doc, d.billTo.address, split - left - 20), ...(d.billTo.email ? [d.billTo.email] : [])];
  const ship = d.shipTo ? wrap(doc, d.shipTo.address, right - split) : [];
  const metaColumns = d.meta.length > 5 ? 2 : 1;
  const perColumn = Math.ceil(d.meta.length / metaColumns);
  // Each detail wraps within its column; a long reference takes two lines rather than running off the band.
  const metaWidth = metaColumns === 2 ? split - left - 20 : right - left;
  const metaBlocks = d.meta.map(([k, v]) => wrap(doc, `${k}: ${v}`, metaWidth));
  const columnLines = (col: number) => metaBlocks.slice(col * perColumn, (col + 1) * perColumn).reduce((n, b) => n + b.length, 0);
  const metaRows = Math.max(columnLines(0), metaColumns === 2 ? columnLines(1) : 0);
  const addressRows = Math.max(bill.length, ship.length);
  const labelled = bill.length > 0 || ship.length > 0;

  const NAME = 14;
  const LINE = 12.5;
  const nameTop = top + (filled ? 28 : 22);
  const labelTop = nameTop + name.length * NAME - 2;
  const addressTop = labelTop + 13;
  const addressEnd = labelled ? addressTop + addressRows * LINE : nameTop + name.length * NAME - NAME;
  const rule = addressEnd + 8;
  const metaTitleTop = rule + 26;
  const metaTop = metaTitleTop + 15;
  const bottom = metaTop + (metaRows - 1) * 13 + (filled ? 22 : 8);

  if (filled) {
    fillWith(doc, band);
    doc.rect(0, top, width, bottom - top, "F");
  }

  doc.setFontSize(11);
  textIn(doc, brand);
  name.forEach((line, i) => doc.text(line, left, nameTop + i * NAME));

  const labels = (label: string, x: number, rows: string[]) => {
    if (rows.length === 0) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    textIn(doc, INK);
    doc.text(label, x, labelTop);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    textIn(doc, SOFT);
    rows.forEach((line, i) => doc.text(line, x, addressTop + i * LINE));
  };
  labels(d.billTo.label ?? "Bill to", left, bill);
  if (d.shipTo) labels(d.shipTo.label ?? "Ship to", split, ship);

  lineIn(doc, filled ? mix(band, INK, 0.2) : RULE, 0.6);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(left, rule, right, rule);
  doc.setLineDashPattern([], 0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  textIn(doc, INK);
  doc.text(d.metaTitle ?? "Details", left, metaTitleTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  textIn(doc, SOFT);
  for (let col = 0; col < metaColumns; col++) {
    let row = 0;
    for (const block of metaBlocks.slice(col * perColumn, (col + 1) * perColumn)) {
      for (const line of block) doc.text(line, col === 0 ? left : split, metaTop + row++ * 13);
    }
  }
  return bottom;
}

// ------------------------------------------------------------------- table

/** The lines: plain with thin rules (classic), on a heading of the brand colour with striped rows (bold), or under a rule of it (clean). */
function drawTable(c: Ctx, autoTable: typeof import("jspdf-autotable").default, startY: number) {
  const { doc, d, look, primary, brand, left } = c;
  const bold = look.style === "bold";
  const clean = look.style === "clean";
  const shift = d.numbered ? 1 : 0;
  const head = d.numbered ? ["#", ...d.head] : d.head;
  const body = d.numbered ? d.rows.map((r, i) => [`${i + 1}.`, ...r]) : d.rows;
  const numeric = d.numeric.map((i) => i + shift);
  const strong = (d.strong ?? []).map((i) => i + shift);
  const boxes = (d.boxes ?? []).map((i) => i + shift);
  const columnStyles: Record<number, { halign?: "right" | "center"; cellWidth?: number; textColor?: Rgb; fontSize?: number }> = {};
  for (const i of numeric) columnStyles[i] = { halign: "right" };
  for (const i of boxes) columnStyles[i] = { halign: "center", cellWidth: 46 };
  if (d.numbered) columnStyles[0] = { cellWidth: 24, textColor: SOFT, fontSize: 8 };
  const padding = { top: 9, bottom: 9, left: 5, right: 5 };
  autoTable(doc, {
    startY,
    head: [head],
    body,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8.5, textColor: INK, cellPadding: padding, valign: "top" },
    headStyles: bold
      ? // Its fill is painted once across the row (willDrawCell): cell by cell leaves hairline seams.
        { fontStyle: "bold", textColor: readableOn(primary), fontSize: 8.5, cellPadding: { ...padding, top: 8, bottom: 8 } }
      : clean
        ? { fontStyle: "bold", textColor: brand, fontSize: 8, cellPadding: { ...padding, top: 8, bottom: 8 } }
        : { fontStyle: "normal", textColor: INK, fontSize: 8.5, cellPadding: { ...padding, top: 8, bottom: 8 } },
    ...(bold ? { alternateRowStyles: { fillColor: tint(primary, 0.95) } } : {}),
    columnStyles,
    // A line with a barcode under its code stays whole: half of it at the top of the next page reads as a line of its own.
    rowPageBreak: "avoid",
    margin: { top: 40, left, right: MARGIN, bottom: 46 },
    willDrawCell: (data) => {
      if (bold && data.section === "head" && data.column.index === 0) {
        fillWith(doc, primary);
        doc.rect(left, data.cell.y, c.right - left, data.cell.height, "F");
      }
    },
    didParseCell: (data) => {
      if (numeric.includes(data.column.index)) data.cell.styles.halign = "right";
      if (boxes.includes(data.column.index)) data.cell.styles.halign = "center";
      if (data.section === "body" && strong.includes(data.column.index)) data.cell.styles.fontStyle = "bold";
    },
    // A thin rule under the heading and every line; bold's fills are their own edges.
    didDrawCell: (data) => {
      if (data.section === "body" && boxes.includes(data.column.index)) {
        // The box sits on the line's first row of text, so a wrapped product name does not leave it floating.
        const size = 12;
        lineIn(doc, BOX, 0.8);
        doc.rect(data.cell.x + (data.cell.width - size) / 2, data.cell.y + padding.top - 2, size, size, "S");
      }
      if (data.section === "foot" || bold) return;
      const underHead = data.section === "head" && clean;
      lineIn(doc, underHead ? brand : RULE, underHead ? 1 : 0.6);
      doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
    },
  });
}

/** A statement's ageing: what is owed, by how late, in a strip of cells. Returns the y below it. */
function drawAgeing(c: Ctx, top: number, cells: [string, string][]): number {
  const { doc, look, band, brand, left, right } = c;
  const height = 40;
  const w = (right - left) / cells.length;
  if (look.style === "clean") {
    lineIn(doc, brand, 0.8);
    doc.line(left, top, right, top);
    lineIn(doc, RULE, 0.6);
    doc.line(left, top + height, right, top + height);
  } else {
    fillWith(doc, band);
    doc.rect(left, top, right - left, height, "F");
  }
  cells.forEach(([label, value], i) => {
    const x = left + i * w + 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    textIn(doc, SOFT);
    doc.text(wrap(doc, label, w - 14)[0] ?? "", x, top + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    textIn(doc, INK);
    doc.text(value, x, top + 30);
  });
  return top + height;
}

// ---------------------------------------------------------------- sign-off

/**
 * The boxes to fill in by hand, across the page: in its foot when there is
 * room, as a form has them, or at the top of a page of their own when the
 * lines have used it up. Kept together, so a signature never lands on a page
 * without the words that say what it means.
 */
function drawSignOff(c: Ctx, s: SignOff, from: number, bottom: number) {
  const { doc, look, brand, left, right } = c;
  const GAP = 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const text = wrap(doc, s.text, right - left);
  const height = 16 + text.length * 11.5 + 6 + s.rows.reduce((n, r) => n + r.height, 0) + GAP * (s.rows.length - 1);
  let y = Math.max(from, bottom - height);
  if (from + height > bottom) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  textIn(doc, look.style === "classic" ? INK : brand);
  doc.text(s.title, left, y + 10);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  textIn(doc, SOFT);
  for (const line of text) {
    doc.text(line, left, y + 9);
    y += 11.5;
  }
  y += 6;
  for (const row of s.rows) {
    const shares = row.boxes.map((b) => b.share ?? 1);
    const total = shares.reduce((n, v) => n + v, 0);
    const room = right - left - GAP * (row.boxes.length - 1);
    let x = left;
    row.boxes.forEach((box, i) => {
      const w = (room * shares[i]) / total;
      lineIn(doc, BOX, 0.8);
      doc.rect(x, y, w, row.height, "S");
      doc.setFontSize(7.5);
      textIn(doc, SOFT);
      doc.text(box.label, x + 6, y + 11);
      x += w + GAP;
    });
    y += row.height + GAP;
  }
}

// ------------------------------------------------------------------ totals

type Totals = { height: number; draw: (top: number) => void };

/**
 * The amounts on the right: VAT and subtotal small, the amount to pay large
 * (on a block of the brand colour in bold, in the brand colour in clean), then
 * whether it is paid.
 */
function totalsBlock(c: Ctx, x: number): Totals {
  const { doc, d, look, primary, brand, right } = c;
  const labelWidth = right - x - 85;
  const last = d.totals.length - 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const small = d.totals.slice(0, Math.max(0, last)).map(([k, v, strong]) => ({ label: wrap(doc, k, labelWidth), value: v, strong: !!strong }));
  const smallHeight = small.reduce((n, r) => n + r.label.length * 11 + 7 + (r.strong ? 10 : 0), 0);
  const lastHeight = look.style === "bold" ? 38 : 30;
  const height = (small.length ? smallHeight + 10 : 0) + (last >= 0 ? lastHeight : 0) + (d.status ? 32 : 0);

  const draw = (top: number) => {
    let y = top + 8;
    const rule = (at: number, colour = RULE, weight = 0.6) => {
      lineIn(doc, colour, weight);
      doc.line(x - 10, at, right, at);
    };
    doc.setFontSize(8.5);
    for (const row of small) {
      if (row.strong) {
        rule(y - 4);
        y += 10;
      }
      doc.setFont("helvetica", row.strong ? "bold" : "normal");
      textIn(doc, row.strong ? INK : SOFT);
      row.label.forEach((line, i) => doc.text(line, x, y + i * 11));
      textIn(doc, INK);
      doc.text(row.value, right, y, { align: "right" });
      y += row.label.length * 11 + 7;
    }
    if (small.length) {
      if (look.style === "clean") rule(y - 4, brand, 0.9);
      else if (look.style === "classic") rule(y - 4);
      y += 10;
    }
    if (last >= 0) {
      const [k, v] = d.totals[last];
      if (look.style === "bold") {
        const on = readableOn(primary);
        fillWith(doc, primary);
        doc.roundedRect(x - 10, y - 6, right - x + 10, 28, 4, 4, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        textIn(doc, on);
        doc.text(k, x, y + 12);
        doc.setFontSize(13);
        doc.text(v, right - 10, y + 12.5, { align: "right" });
        y += lastHeight;
      } else if (look.style === "clean") {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        textIn(doc, SOFT);
        doc.text(k, x, y + 8);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        textIn(doc, brand);
        doc.text(v, right, y + 9, { align: "right" });
        y += lastHeight;
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        textIn(doc, INK);
        doc.text(k, x, y + 8);
        doc.setFontSize(14);
        doc.text(v, right, y + 9, { align: "right" });
        y += lastHeight;
      }
    }
    if (d.status) {
      rule(y - 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      textIn(doc, TONES[d.status.tone]);
      doc.text(d.status.label, x, y + 14);
      if (d.status.detail) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        textIn(doc, SOFT);
        doc.text(d.status.detail, right, y + 13, { align: "right" });
      }
    }
  };
  return { height, draw };
}

/**
 * The document, drawn and not yet saved. The logo is optional and the look is
 * given, so this needs no browser and no company: the tests draw every look
 * from it.
 */
export async function buildMoneyPdf(d: PdfSpec, look: PdfLook, logo: LogoImage | null): Promise<Doc> {
  return buildMoneyPdfs([{ spec: d, logo }], look);
}

/**
 * Several documents in one PDF, so a batch prints from one print box: each
 * starts on a page of its own and numbers only its own pages.
 */
export async function buildMoneyPdfs(docs: { spec: PdfSpec; logo: LogoImage | null }[], look: PdfLook): Promise<Doc> {
  if (docs.length === 0) throw new Error("There is nothing to print.");
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  docs.forEach(({ spec, logo }, i) => {
    if (i > 0) doc.addPage();
    drawDocument(doc, autoTableModule.default, spec, look, logo);
  });
  return doc;
}

/** One document onto `doc`, from its current page on. */
function drawDocument(doc: Doc, autoTable: typeof import("jspdf-autotable").default, d: PdfSpec, look: PdfLook, logo: LogoImage | null) {
  const first = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const left = MARGIN;
  const right = width - MARGIN;
  const bottom = height - 46;
  const primary = hexToRgb(look.primary);
  const c: Ctx = { doc, d, logo, look, primary, brand: brandText(primary), band: wash(primary), left, right, width };

  const bandTop = look.style === "bold" ? headerBold(c) : look.style === "clean" ? headerClean(c) : headerClassic(c);
  const tableTop = drawBand(c, bandTop) + 22;
  drawTable(c, autoTable, tableTop);

  let top = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  if (d.ageing?.length) {
    if (top + 54 > bottom) {
      doc.addPage();
      top = 50;
    }
    top = drawAgeing(c, top + 6, d.ageing) + 12;
  }

  // Under the lines: the totals on the right, kept together (on a new page if
  // they would run off this one), and the note to the customer on the left.
  const totalsX = right - 215;
  const totals = totalsBlock(c, totalsX);
  if (top + totals.height > bottom) {
    doc.addPage();
    top = 50;
  }
  totals.draw(top);
  const totalsPage = doc.getNumberOfPages();

  // The note column starts beside the totals and continues on a new page if it is long.
  const nx = left + (d.numbered ? 29 : 5);
  const noteWidth = totalsX - 34 - nx;
  let y = top + 22;
  const room = (h: number) => {
    if (y + h > bottom) {
      doc.addPage();
      y = 50;
    }
  };
  const title = (text: string) => {
    room(30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    textIn(doc, look.style === "classic" ? INK : c.brand);
    doc.text(text, nx, y);
    y += 15;
  };
  const paragraph = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    textIn(doc, SOFT);
    for (const line of wrap(doc, text, noteWidth)) {
      room(11.5);
      doc.text(line, nx, y);
      y += 11.5;
    }
    y += 5;
  };
  const notes = [...(d.notes ?? []), ...(d.footer ? [d.footer] : [])].filter((n) => n.trim() !== "");
  if (notes.length) {
    title(d.notesTitle ?? "Note to customer");
    notes.forEach(paragraph);
    y += 8;
  }
  if (d.payTo?.trim()) {
    title("How to pay");
    paragraph(d.payTo);
  }
  if (d.signOff) {
    // Under the notes and the totals, whichever ends lower (the totals only count while the notes are on their page).
    const end = doc.getNumberOfPages() === totalsPage ? Math.max(y, top + totals.height) : y;
    drawSignOff(c, d.signOff, end + 18, bottom);
  }

  // Page numbers once the document has more than one page.
  const last = doc.getNumberOfPages();
  const pages = last - first + 1;
  if (pages > 1) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    textIn(doc, SOFT);
    for (let p = first; p <= last; p++) {
      doc.setPage(p);
      doc.text(`Page ${p - first + 1} of ${pages}`, right, height - 22, { align: "right" });
    }
  }
}

async function loadLogo(d: PdfSpec): Promise<LogoImage | null> {
  return loadLogoAt(d.seller.logoPath ?? null);
}

async function loadLogoAt(path: string | null): Promise<LogoImage | null> {
  // A logo that cannot be fetched is left off rather than failing the download.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return loadLogoImage(supabaseUrl ? logoUrl(supabaseUrl, path) : null);
}

async function lookOf(d: PdfSpec): Promise<PdfLook> {
  if (d.look) return d.look;
  const { loadDocumentLook } = await import("@/lib/document-look");
  return loadDocumentLook();
}

export async function drawMoneyPdf(d: PdfSpec) {
  const [look, logo] = await Promise.all([lookOf(d), loadLogo(d)]);
  const doc = await buildMoneyPdf(d, look, logo);
  doc.save(`${d.fileName}.pdf`);
}

/** Several documents printed as one: `title` names the tab and the file "Save as PDF" offers. */
export type PdfBatch = { title: string; specs: PdfSpec[] };

/** The most documents one print draws: more, and the browser builds a PDF of hundreds of pages while the page freezes. */
export const PRINT_AT_ONCE = 100;

/** Why a batch this big is refused, or null when it can print. */
export function tooManyToPrint(count: number): string | null {
  return count > PRINT_AT_ONCE
    ? `That is ${count} documents. Print up to ${PRINT_AT_ONCE} at a time: narrow the dates or the filter, or untick some.`
    : null;
}

/**
 * Print the document: the same PDF the download saves, opened in a new tab
 * with the print box already up (the PDF asks for it as it opens, which the
 * viewers in Chrome and Edge do). Given a batch, every document goes into the
 * one PDF, so a stack of invoices or picking lists is one print box. The
 * documents are only asked for once the tab is open, because reading orders
 * first would use up the click and a pop-up blocker would refuse the tab.
 * Where the tab is refused anyway, the PDF downloads instead, so the click
 * still gives the person something to print.
 */
export async function printMoneyPdf(load: () => Promise<PdfSpec | PdfBatch>) {
  // A second click while the first is still reading would open a second tab and print the sheets twice.
  if (printing) return;
  printing = true;
  const win = window.open("", "_blank");
  try {
    if (win) {
      win.document.title = "Getting it ready to print";
      win.document.body.style.font = "16px system-ui, sans-serif";
      win.document.body.textContent = "Getting the documents ready to print…";
    }
    const got = await load();
    const batch: PdfBatch = "specs" in got ? got : { title: got.fileName, specs: [got] };
    if (batch.specs.length === 0) throw new Error("There is nothing to print.");
    const tooMany = tooManyToPrint(batch.specs.length);
    if (tooMany) throw new Error(tooMany);
    // One company's paper: its look, and each logo fetched once (an invoice keeps the logo it was issued with).
    const paths = [...new Set(batch.specs.map((d) => d.seller.logoPath ?? null))];
    const [look, logos] = await Promise.all([lookOf(batch.specs[0]), Promise.all(paths.map((path) => loadLogoAt(path)))]);
    const logoOf = new Map(paths.map((path, i) => [path, logos[i]]));
    const doc = await buildMoneyPdfs(
      batch.specs.map((spec) => ({ spec, logo: logoOf.get(spec.seller.logoPath ?? null) ?? null })),
      look
    );
    if (!win) {
      doc.save(`${batch.title}.pdf`);
      return;
    }
    // The tab's title, and the file name Chrome offers under "Save as PDF".
    doc.setProperties({ title: batch.title });
    doc.autoPrint();
    win.location.href = doc.output("bloburl") as unknown as string;
  } catch (e) {
    win?.close();
    throw e;
  } finally {
    printing = false;
  }
}
let printing = false;

/** Open the document in a new tab instead of downloading it (the settings preview). */
export async function previewMoneyPdf(d: PdfSpec) {
  // The tab opens first, while the click is still fresh, or a pop-up blocker refuses it.
  const win = window.open("", "_blank");
  try {
    const [look, logo] = await Promise.all([lookOf(d), loadLogo(d)]);
    const doc = await buildMoneyPdf(d, look, logo);
    const url = doc.output("bloburl") as unknown as string;
    if (win) win.location.href = url;
  } catch (e) {
    win?.close();
    throw e;
  }
}
