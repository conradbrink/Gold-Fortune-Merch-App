import { logoUrl } from "@/lib/branding";
import { fitBox, loadLogoImage } from "@/lib/pdf-logo";

/**
 * One letterhead for every money document — invoice, credit note, quote and
 * statement — so they read as one company's paperwork.
 *
 * The layout is the tax invoice's as it has always been: the seller top left
 * (logo above), the heading and its numbers top right, who it is for, the
 * lines, the totals, then notes and the footer. A document passes what it
 * has; empty fields are left out rather than printed blank.
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
};

export async function drawMoneyPdf(d: PdfSpec) {
  // A logo that cannot be fetched is left off rather than failing the download.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const [{ jsPDF }, autoTableModule, logo] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    loadLogoImage(supabaseUrl ? logoUrl(supabaseUrl, d.seller.logoPath ?? null) : null),
  ]);
  const autoTable = autoTableModule.default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = width - 40;
  const bottom = height - 40;

  // The logo above the seller's name, which moves down to make room. Without
  // one the seller block starts where it always has.
  let sellerTop = 52;
  if (logo) {
    const box = fitBox(logo.width, logo.height, 160, 44);
    doc.addImage(logo.dataUrl, "PNG", left, 30, box.width, box.height);
    sellerTop = 30 + box.height + 18;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(d.seller.name, left, sellerTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);
  const seller = [
    ...(d.seller.address ? doc.splitTextToSize(d.seller.address, 240) : []),
    d.seller.registrationNumber && `Reg no: ${d.seller.registrationNumber}`,
    d.seller.taxNumber && `TIN: ${d.seller.taxNumber}`,
    d.seller.vatNumber && `VAT no: ${d.seller.vatNumber}`,
    d.seller.phone,
    d.seller.email,
  ].filter(Boolean) as string[];
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

  let y = Math.max(sellerTop + 16 + seller.length * 12, 70 + d.meta.length * 13) + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(d.billTo.label ?? "BILL TO", left, y);
  doc.setTextColor(20);
  doc.setFontSize(10);
  doc.text(d.billTo.name, left, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const addr = [
    ...(d.billTo.address ? doc.splitTextToSize(d.billTo.address, 260) : []),
    ...(d.billTo.email ? [d.billTo.email] : []),
  ] as string[];
  addr.forEach((line, i) => doc.text(line, left, y + 27 + i * 12));
  y += 27 + addr.length * 12 + 12;

  const columnStyles: Record<number, { halign: "right" }> = {};
  for (const i of d.numeric) columnStyles[i] = { halign: "right" };
  autoTable(doc, {
    startY: y,
    head: [d.head],
    body: d.rows,
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles,
    margin: { left, right: 40 },
  });

  let finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  // The totals stay together: on a new page if they would run off this one.
  if (finalY + d.totals.length * 15 > bottom) {
    doc.addPage();
    finalY = 50;
  }
  d.totals.forEach(([k, v], i) => {
    const last = i === d.totals.length - 1;
    doc.setFont("helvetica", last ? "bold" : "normal");
    doc.setFontSize(last ? 11 : 9);
    doc.text(k, right - 130, finalY + i * 15);
    doc.text(v, right, finalY + i * 15, { align: "right" });
  });

  let fy = finalY + d.totals.length * 15 + 20;
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
    doc.text("How to pay", left, fy);
    fy += 12;
    doc.setFont("helvetica", "normal");
    paragraph(d.payTo);
  }
  if (d.footer) paragraph(d.footer);
  doc.save(`${d.fileName}.pdf`);
}
