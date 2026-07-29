/**
 * Reads a spreadsheet the manager picked, in their own browser.
 *
 * The file never leaves the machine — there is no upload endpoint. That is
 * both simpler and better: a customer list is commercially sensitive, and the
 * only copy that needs to exist is the one already on their disk.
 *
 * ## On the parser
 *
 * SheetJS is the only practical way to read legacy BIFF `.xls`, which is what
 * QuickBooks and WhatsApp exports actually produce. The npm build (0.18.5) is
 * the last one published to the registry and carries two high advisories —
 * prototype pollution and a ReDoS — both fixed only in 0.19.3+, which SheetJS
 * publishes exclusively to their own CDN.
 *
 * Two things contain that here:
 *
 * - Rows are read in **array mode** (`header: 1`) and copied field by field
 *   into a `null`-prototype object. Object mode would let a column literally
 *   headed `__proto__` reach `Object.prototype`, which is the pollution path.
 *   `DANGEROUS_KEYS` closes it explicitly rather than relying on that.
 * - The input is a file the manager chose themselves. There is no route by
 *   which an attacker supplies the bytes, so the ReDoS costs them their own
 *   tab and nothing else.
 *
 * Upgrading to the CDN build (`npm i https://cdn.sheetjs.com/xlsx-0.20.3/…`)
 * removes both and is worth doing when a non-registry install is acceptable.
 */

export type ParsedSheet = {
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
};

/** Keys that must never become object properties, whatever the file says. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  // Dynamic import: SheetJS is large and only the import dialog needs it, so
  // it stays out of the bundle every other page pays for.
  const XLSX = await import("xlsx");

  const buffer = await file.arrayBuffer();
  const book = XLSX.read(new Uint8Array(buffer), { type: "array" });

  const sheetName = book.SheetNames[0];
  if (!sheetName) throw new Error("That file has no sheets in it.");
  const sheet = book.Sheets[sheetName];

  // `header: 1` yields arrays of cells. `raw: false` formats dates and numbers
  // as the strings the user sees, so a phone number does not arrive as 2.6e10.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  if (grid.length < 2) {
    throw new Error("That sheet has no data rows — expected a header row and at least one store.");
  }

  const headers = (grid[0] as unknown[]).map((h, i) => {
    const text = String(h ?? "").trim();
    // Unnamed columns still need a stable handle for the mapping dropdowns.
    return text === "" ? `Column ${i + 1}` : text;
  });

  const seen = new Set<string>();
  const safeHeaders = headers.map((h, i) => {
    const key = DANGEROUS_KEYS.has(h.toLowerCase()) ? `Column ${i + 1}` : h;
    // Duplicate headers would silently overwrite each other otherwise.
    if (!seen.has(key)) {
      seen.add(key);
      return key;
    }
    return `${key} (${i + 1})`;
  });

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r] as unknown[];
    const row = Object.create(null) as Record<string, string>;
    let any = false;
    for (let c = 0; c < safeHeaders.length; c++) {
      const text = String(cells[c] ?? "").trim();
      row[safeHeaders[c]] = text;
      if (text) any = true;
    }
    if (any) rows.push(row);
  }

  return { sheetName, headers: safeHeaders, rows };
}

export const ACCEPTED_EXTENSIONS = ".xls,.xlsx,.xlsm,.csv";
