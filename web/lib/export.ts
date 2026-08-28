/**
 * One table, three files.
 *
 * Every export in the app describes what it is exporting in the same shape —
 * a title, the filters that produced it, columns and rows — and this module
 * turns that into CSV, Excel or PDF. The alternative was a `exportCsv` per
 * page, which is how the Reports page ended up with a quoting rule that no
 * other page had and none of them had a header saying which filters were
 * applied. A spreadsheet that does not say what it is a spreadsheet *of* is the
 * one somebody misreads in a meeting.
 *
 * `xlsx` and `jspdf` are both imported dynamically. They are large, and nobody
 * pays for them until they press Export — which on most page loads is nobody.
 */

export type ExportColumn = {
  /** Column heading, as a person would read it. */
  header: string;
  /** Key into each row. */
  key: string;
  /** Right-aligns in the PDF and picks a numeric cell format in Excel. */
  numeric?: boolean;
};

export type ExportSheet = {
  /** What this is. "Store visits", "Discrepancies", "Stores". */
  title: string;
  /**
   * The filters that produced it, one per line — a rep's name, the date range,
   * "Gaborone only". This is the difference between a file and a claim.
   */
  context?: string[];
  columns: ExportColumn[];
  rows: Record<string, string | number | null | undefined>[];
  /** Base file name, without extension or date. */
  filename: string;
  /** Shown above the title. Falls back to nothing rather than a guess. */
  orgName?: string;
};

export type ExportFormat = "csv" | "xlsx" | "pdf";

/** `gf-store-visits-2026-08-27.xlsx` */
function fileName(sheet: ExportSheet, extension: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${sheet.filename}-${today}.${extension}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** A cell as text. `null` and `undefined` are blank, never "null". */
function text(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Stops a cell being read as a formula.
 *
 * Excel, LibreOffice and Sheets all evaluate a cell whose text begins `=`, `+`,
 * `-` or `@`, and every string in these exports came from somebody typing it:
 * a store name, a rejection note, a rep's own reason for leave. A store called
 * `=cmd|'/c calc'!A1` is a real attack in a real product, and the person who
 * opens the file is the manager who asked for it.
 *
 * A leading apostrophe is the standard neutraliser — the spreadsheet drops it
 * on display and treats the rest as text. Numbers are untouched: they go into
 * the sheet as numbers, never through here, so a negative figure is still
 * negative and still sums.
 */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function matrix(sheet: ExportSheet): (string | number)[][] {
  return [
    sheet.columns.map((c) => c.header),
    ...sheet.rows.map((row) =>
      sheet.columns.map((c) => {
        const value = row[c.key];
        if (c.numeric && typeof value === "number") return value;
        return neutralise(text(value));
      })
    ),
  ];
}

/**
 * CSV, with the context lines above the table.
 *
 * Every cell is quoted and embedded quotes doubled — store names contain
 * commas, and a rep called O'Brien is not a quoting bug waiting to happen.
 */
function toCsv(sheet: ExportSheet): string {
  const quote = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
  const preamble: (string | number)[][] = [
    ...(sheet.orgName ? [[sheet.orgName]] : []),
    [sheet.title],
    ...(sheet.context ?? []).map((line) => [line]),
    [],
  ];
  return [...preamble, ...matrix(sheet)]
    .map((r) => r.map(quote).join(","))
    .join("\n");
}

export function exportCsv(sheet: ExportSheet): void {
  // The BOM is what makes Excel open a UTF-8 CSV as UTF-8 rather than as
  // Windows-1252, which is the difference between "Rustenburg" and mojibake on
  // every store whose name carries an accent.
  download(
    new Blob(["﻿" + toCsv(sheet)], { type: "text/csv;charset=utf-8" }),
    fileName(sheet, "csv")
  );
}

export async function exportXlsx(sheet: ExportSheet): Promise<void> {
  const XLSX = await import("xlsx");
  const preamble: (string | number)[][] = [
    ...(sheet.orgName ? [[sheet.orgName]] : []),
    [sheet.title],
    ...(sheet.context ?? []).map((line) => [line]),
    [],
  ];
  const ws = XLSX.utils.aoa_to_sheet([...preamble, ...matrix(sheet)]);

  // Column widths from the widest cell, capped. Excel's default is 8 characters
  // and a store name is not eight characters, so without this every export
  // opens as a wall of `####`.
  ws["!cols"] = sheet.columns.map((c) => {
    const widest = sheet.rows.reduce(
      (max, row) => Math.max(max, text(row[c.key]).length),
      c.header.length
    );
    return { wch: Math.min(Math.max(widest + 2, 10), 44) };
  });
  // Freeze the header row, which sits below the preamble.
  const headerRow = preamble.length + 1;
  ws["!freeze"] = { xSplit: 0, ySplit: headerRow };

  const wb = XLSX.utils.book_new();
  // Excel refuses a sheet name over 31 characters or containing : \ / ? * [ ].
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    sheet.title.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Export"
  );
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  download(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName(sheet, "xlsx")
  );
}

export async function exportPdf(sheet: ExportSheet): Promise<void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  // Landscape past six columns. A seven-column table on portrait A4 wraps every
  // cell onto three lines and the page stops being readable, which defeats the
  // point of a format chosen for printing.
  const doc = new jsPDF({
    orientation: sheet.columns.length > 6 ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });
  const width = doc.internal.pageSize.getWidth();

  let y = 44;
  if (sheet.orgName) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(sheet.orgName, 40, y);
    y += 16;
  }
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(sheet.title, 40, y);
  y += 18;

  doc.setFontSize(9);
  doc.setTextColor(110);
  for (const line of sheet.context ?? []) {
    doc.text(line, 40, y);
    y += 12;
  }

  // autoTable sizes columns by content, so one very wide cell takes the page
  // and squeezes the rest until their *headers* break mid-word — a form-results
  // export came out with columns headed "Questio n", "Typ e" and "Answer s".
  // Measuring the header in the face it is actually drawn in and setting that
  // as the floor means a column is never narrower than its own name.
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  const headerFloor = sheet.columns.map((c) => doc.getTextWidth(c.header) + 10);
  // Measuring under bold 8pt is what makes the floor right — the header IS
  // drawn bold. Restoring is what stops it leaking: `didDrawPage` below sets
  // only size and colour, so without this the "Generated …" and "Page N"
  // footers came out bold on every export in the app.
  doc.setFont("helvetica", "normal");

  autoTable(doc, {
    startY: y + 6,
    head: [sheet.columns.map((c) => c.header)],
    body: sheet.rows.map((row) => sheet.columns.map((c) => text(row[c.key]))),
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 247, 249] },
    columnStyles: Object.fromEntries(
      sheet.columns.map((c, i) => [
        i,
        {
          halign: c.numeric ? "right" : "left",
          minCellWidth: headerFloor[i],
        },
      ])
    ),
    margin: { left: 40, right: 40, bottom: 40 },
    // Drawn per page rather than at the end: `getNumberOfPages` is only right
    // once the table has finished, and a footer written in the hook is written
    // on the page it belongs to.
    didDrawPage: (data) => {
      const page = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(
        `Generated ${new Date().toLocaleString("en-ZA")}`,
        data.settings.margin.left,
        doc.internal.pageSize.getHeight() - 22
      );
      doc.text(
        `Page ${page}`,
        width - data.settings.margin.right,
        doc.internal.pageSize.getHeight() - 22,
        { align: "right" }
      );
    },
  });

  download(doc.output("blob"), fileName(sheet, "pdf"));
}

export async function exportSheet(
  sheet: ExportSheet,
  format: ExportFormat
): Promise<void> {
  if (format === "csv") return exportCsv(sheet);
  if (format === "xlsx") return exportXlsx(sheet);
  return exportPdf(sheet);
}
