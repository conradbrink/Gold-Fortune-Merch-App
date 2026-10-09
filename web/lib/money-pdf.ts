import { logoUrl } from "@/lib/branding";
import { fitBox, loadLogoImage, type LogoImage } from "@/lib/pdf-logo";
import { hexToRgb, mix, onWhite, readableOn, tint, type PdfLook, type Rgb } from "@/lib/document-style";

/**
 * One letterhead for every money document — invoice, credit note, quote and
 * statement — so they read as one company's paperwork.
 *
 * Three looks, chosen by the company (`document_style`): `classic` is the tax
 * invoice's layout as it has always been (the seller top left with the logo
 * above, the heading and its numbers top right, who it is for, the lines, the
 * totals, then notes and the footer); `bold` puts the heading and logo in a band
 * of the company's colour; `clean` centres the letterhead and keeps to thin
 * lines. All three carry the same things in the same order. A document passes
 * what it has; empty fields are left out rather than printed blank.
 */

export const money = (n: number) =>
  Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  meta: [string, string][];
  billTo: { label?: string; name: string; address?: string | null; email?: string | null };
  head: string[];
  rows: string[][];
  /** Column indexes printed right-aligned (numbers). */
  numeric: number[];
  totals: [string, string][];
  /** Paragraphs under the totals: a void stamp, a reason, terms. */
  notes?: string[];
  /** "How to pay": bank details, printed under a heading of their own. */
  payTo?: string | null;
  footer?: string | null;
  /** The look to draw in; without one, the company's own is read. */
  look?: PdfLook;
};

const LEFT = 40;

type Doc = import("jspdf").jsPDF;
type Ctx = { doc: Doc; d: PdfSpec; logo: LogoImage | null; look: PdfLook; left: number; right: number; width: number };

const set = (fn: (r: number, g: number, b: number) => void, c: Rgb) => fn(c[0], c[1], c[2]);

/** The seller's address and numbers, one string per line. */
function sellerLines(doc: Doc, d: PdfSpec, wrap: number): string[] {
  return [
    ...(d.seller.address ? (doc.splitTextToSize(d.seller.address, wrap) as string[]) : []),
    d.seller.registrationNumber && `Reg no: ${d.seller.registrationNumber}`,
    d.seller.taxNumber && `TIN: ${d.seller.taxNumber}`,
    d.seller.vatNumber && `VAT no: ${d.seller.vatNumber}`,
    d.seller.phone,
    d.seller.email,
  ].filter(Boolean) as string[];
}

/** Who it is for: label, name, address and email, at x. Returns the y below it. */
function billToBlock(c: Ctx, x: number, y: number, labelColour: Rgb): number {
  const { doc, d } = c;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  set(doc.setTextColor.bind(doc), labelColour);
  doc.text(d.billTo.label ?? "BILL TO", x, y);
  doc.setTextColor(20);
  doc.setFontSize(10);
  doc.text(d.billTo.name, x, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const addr = [
    ...(d.billTo.address ? (doc.splitTextToSize(d.billTo.address, 260) as string[]) : []),
    ...(d.billTo.email ? [d.billTo.email] : []),
  ];
  addr.forEach((line, i) => doc.text(line, x, y + 27 + i * 12));
  return y + 27 + addr.length * 12 + 12;
}

// ---------------------------------------------------------------- classic

/** The layout the invoice has always had. Returns the y the table starts at. */
function headerClassic(c: Ctx): number {
  const { doc, d, logo, left, right } = c;
  // The logo above the seller's name, which moves down to make room. Without
  // one the seller block starts where it always has.
  let sellerTop = 52;
  if (logo) {
    const box = fitBox(logo.width, logo.height, 160, 44);
    doc.addImage(logo.dataUrl, logo.format ?? "PNG", left, 30, box.width, box.height);
    sellerTop = 30 + box.height + 18;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(d.seller.name, left, sellerTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const seller = sellerLines(doc, d, 240);
  seller.forEach((line, i) => doc.text(line, left, sellerTop + 16 + i * 12));

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(d.heading, right, 52, { align: "right" });
  doc.setFontSize(9);
  d.meta.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    doc.text(k, right - 110, 70 + i * 13);
    doc.setTextColor(20);
    doc.text(v, right, 70 + i * 13, { align: "right" });
  });

  const y = Math.max(sellerTop + 16 + seller.length * 12, 70 + d.meta.length * 13) + 18;
  return billToBlock(c, left, y, [90, 90, 90]);
}

// ------------------------------------------------------------------- bold

/** A band of the company's colour with the logo and heading in it. */
function headerBold(c: Ctx): number {
  const { doc, d, logo, left, right, width, look } = c;
  const primary = hexToRgb(look.primary);
  const ink = readableOn(primary);
  const faint = mix(ink, primary, 0.25);
  const band = Math.max(104, 70 + d.meta.length * 13 + 14);

  set(doc.setFillColor.bind(doc), primary);
  doc.rect(0, 0, width, band, "F");
  set(doc.setFillColor.bind(doc), hexToRgb(look.accent));
  doc.rect(0, band, width, 3, "F");

  // The logo on a white plate, so any logo reads on any colour. Without one,
  // the company's name takes its place.
  if (logo) {
    const box = fitBox(logo.width, logo.height, 150, 48);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(left, 26, box.width + 16, box.height + 16, 6, 6, "F");
    doc.addImage(logo.dataUrl, logo.format ?? "PNG", left + 8, 34, box.width, box.height);
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    set(doc.setTextColor.bind(doc), ink);
    doc.text(doc.splitTextToSize(d.seller.name, 260) as string[], left, 52);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  set(doc.setTextColor.bind(doc), ink);
  doc.text(d.heading, right, 50, { align: "right" });
  doc.setFontSize(9);
  d.meta.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal");
    set(doc.setTextColor.bind(doc), faint);
    doc.text(k, right - 110, 70 + i * 13);
    set(doc.setTextColor.bind(doc), ink);
    doc.text(v, right, 70 + i * 13, { align: "right" });
  });

  // Below the band: the seller on the left, who it is for on the right.
  const top = band + 3 + 26;
  let sy = top;
  if (logo) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text(d.seller.name, left, sy);
    sy += 16;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const seller = sellerLines(doc, d, 230);
  seller.forEach((line, i) => doc.text(line, left, sy + i * 12));
  sy += seller.length * 12;
  const by = billToBlock(c, width / 2 + 20, top, onWhite(primary));
  return Math.max(sy + 12, by) + 6;
}

// ------------------------------------------------------------------ clean

/** A centred letterhead, a thin rule in the company's colour, and nothing filled. */
function headerClean(c: Ctx): number {
  const { doc, d, logo, left, right, width, look } = c;
  const accent = onWhite(hexToRgb(look.primary));
  let y = 40;
  if (logo) {
    const box = fitBox(logo.width, logo.height, 150, 46);
    doc.addImage(logo.dataUrl, logo.format ?? "PNG", (width - box.width) / 2, y, box.width, box.height);
    y += box.height + 16;
  } else {
    y += 8;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(d.seller.name, width / 2, y, { align: "center" });
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  const flat = (t: string) => t.split(/\s*\n\s*/).filter(Boolean).join(", ");
  const numbers = [
    d.seller.registrationNumber && `Reg no: ${d.seller.registrationNumber}`,
    d.seller.taxNumber && `TIN: ${d.seller.taxNumber}`,
    d.seller.vatNumber && `VAT no: ${d.seller.vatNumber}`,
  ].filter(Boolean) as string[];
  const contact = [d.seller.phone, d.seller.email].filter(Boolean) as string[];
  const lines = [
    ...(d.seller.address ? (doc.splitTextToSize(flat(d.seller.address), 380) as string[]) : []),
    ...(numbers.length ? [numbers.join("   ·   ")] : []),
    ...(contact.length ? [contact.join("   ·   ")] : []),
  ];
  lines.forEach((line, i) => doc.text(line, width / 2, y + i * 11.5, { align: "center" }));
  y += lines.length * 11.5 + 10;

  set(doc.setDrawColor.bind(doc), accent);
  doc.setLineWidth(1.2);
  doc.line(left, y, right, y);
  y += 34;

  // The heading, spaced out, on the left; the numbers on the right.
  set(doc.setTextColor.bind(doc), accent);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(22);
  doc.setCharSpace(3);
  doc.text(d.heading, left, y);
  doc.setCharSpace(0);
  doc.setFontSize(9);
  d.meta.forEach(([k, v], i) => {
    doc.setTextColor(100);
    doc.text(k, right - 110, y - 12 + i * 13);
    doc.setTextColor(20);
    doc.text(v, right, y - 12 + i * 13, { align: "right" });
  });
  const metaBottom = y - 12 + d.meta.length * 13;
  const by = billToBlock(c, left, y + 30, [120, 120, 120]);
  return Math.max(by, metaBottom + 10) + 4;
}

// ------------------------------------------------------------------ table

/** Numbers sit right-aligned, and so do the headings above them. */
function alignNumericHeads(numeric: number[]) {
  return (data: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => {
    if (data.section === "head" && numeric.includes(data.column.index)) data.cell.styles.halign = "right";
  };
}

function drawTable(c: Ctx, autoTable: typeof import("jspdf-autotable").default, startY: number) {
  const { doc, d, look, left } = c;
  const columnStyles: Record<number, { halign: "right" }> = {};
  for (const i of d.numeric) columnStyles[i] = { halign: "right" };
  const margin = { left, right: 40 };
  if (look.style === "bold") {
    const primary = hexToRgb(look.primary);
    autoTable(doc, {
      startY,
      head: [d.head],
      body: d.rows,
      styles: { fontSize: 8.5, cellPadding: 6 },
      headStyles: { fillColor: primary, textColor: readableOn(primary) },
      alternateRowStyles: { fillColor: tint(primary, 0.94) },
      columnStyles,
      margin,
      didParseCell: alignNumericHeads(d.numeric),
    });
  } else if (look.style === "clean") {
    const accent = onWhite(hexToRgb(look.primary));
    autoTable(doc, {
      startY,
      head: [d.head],
      body: d.rows,
      theme: "plain",
      styles: { fontSize: 8.5, cellPadding: { top: 7, bottom: 7, left: 4, right: 4 }, textColor: 30 },
      headStyles: { textColor: accent, fontStyle: "bold", fontSize: 8 },
      columnStyles,
      margin,
      didParseCell: alignNumericHeads(d.numeric),
      // Thin lines only: a hairline under every row, a firmer one under the head.
      didDrawCell: (data) => {
        if (data.section === "foot") return;
        const head = data.section === "head";
        set(doc.setDrawColor.bind(doc), head ? accent : [226, 226, 226]);
        doc.setLineWidth(head ? 1 : 0.4);
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
      },
    });
  } else {
    autoTable(doc, {
      startY,
      head: [d.head],
      body: d.rows,
      styles: { fontSize: 8.5, cellPadding: 5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles,
      margin,
    });
  }
}

// ----------------------------------------------------------------- totals

/** Height of each totals row: the last (the amount due) is bigger in bold and clean. */
const rowHeight = (look: PdfLook, last: boolean) => (last && look.style !== "classic" ? 36 : 15);

function drawTotals(c: Ctx, startY: number) {
  const { doc, d, look, right } = c;
  let y = startY;
  d.totals.forEach(([k, v], i) => {
    const last = i === d.totals.length - 1;
    if (!last || look.style === "classic") {
      doc.setFont("helvetica", last ? "bold" : "normal");
      doc.setFontSize(last ? 11 : 9);
      doc.text(k, right - 130, y);
      doc.text(v, right, y, { align: "right" });
      y += 15;
      return;
    }
    if (look.style === "bold") {
      // The amount due on a block of the company's colour.
      const primary = hexToRgb(look.primary);
      y += 6;
      set(doc.setFillColor.bind(doc), primary);
      doc.roundedRect(right - 200, y - 14, 200, 26, 4, 4, "F");
      set(doc.setTextColor.bind(doc), readableOn(primary));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(k, right - 190, y + 3);
      doc.text(v, right - 10, y + 3, { align: "right" });
    } else {
      // The amount due in large type, over a thin rule.
      const accent = onWhite(hexToRgb(look.primary));
      set(doc.setDrawColor.bind(doc), accent);
      doc.setLineWidth(0.8);
      doc.line(right - 200, y - 12, right, y - 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(k, right - 200, y + 8);
      set(doc.setTextColor.bind(doc), accent);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.text(v, right, y + 8, { align: "right" });
    }
    y += 30;
  });
  return y;
}

/**
 * The document, drawn and not yet saved. The logo is optional and the look is
 * given, so this needs no browser and no company: the tests draw every look
 * from it.
 */
export async function buildMoneyPdf(d: PdfSpec, look: PdfLook, logo: LogoImage | null): Promise<Doc> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const left = LEFT;
  const right = width - 40;
  const bottom = height - 40;
  const c: Ctx = { doc, d, logo, look, left, right, width };

  const tableTop = look.style === "bold" ? headerBold(c) : look.style === "clean" ? headerClean(c) : headerClassic(c);
  drawTable(c, autoTable, tableTop);

  let finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  // The totals stay together: on a new page if they would run off this one.
  const needed = d.totals.reduce((n, _t, i) => n + rowHeight(look, i === d.totals.length - 1), 0);
  if (finalY + needed > bottom) {
    doc.addPage();
    finalY = 50;
  }
  finalY = drawTotals(c, finalY + (look.style === "classic" ? 0 : 6));

  let fy = finalY + 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60);
  // Long notes or bank details continue on a new page rather than off the end.
  const room = (h: number) => {
    if (fy + h > bottom) {
      doc.addPage();
      fy = 50;
    }
  };
  const paragraph = (text: string) => {
    for (const line of doc.splitTextToSize(text, right - left)) {
      room(12);
      doc.text(line, left, fy);
      fy += 12;
    }
    fy += 6;
  };
  for (const note of d.notes ?? []) paragraph(note);
  if (d.payTo) {
    room(24);
    doc.setFont("helvetica", "bold");
    if (look.style !== "classic") set(doc.setTextColor.bind(doc), onWhite(hexToRgb(look.primary)));
    doc.text("How to pay", left, fy);
    doc.setTextColor(60);
    fy += 12;
    doc.setFont("helvetica", "normal");
    paragraph(d.payTo);
  }
  if (d.footer) paragraph(d.footer);
  return doc;
}

async function loadLogo(d: PdfSpec): Promise<LogoImage | null> {
  // A logo that cannot be fetched is left off rather than failing the download.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return loadLogoImage(supabaseUrl ? logoUrl(supabaseUrl, d.seller.logoPath ?? null) : null);
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
