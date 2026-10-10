/**
 * The Founding 10 leads as a spreadsheet file: who they are and how to reach
 * them. Written for the owner to open in Excel or paste into a mailing tool.
 */

export type LeadRow = {
  created_at: string;
  name: string;
  email: string | null;
  whatsapp: string;
  business_name: string;
  trade: string;
  town: string;
  status: string;
  source: string | null;
};

const HEADERS = ["Name", "Email", "WhatsApp (with country code)", "Business", "Type of work", "Town or city", "Status", "Came from", "Applied (UTC)"];

/**
 * One CSV cell. A value a person typed that starts with = + - or @ is read by
 * Excel as a formula, so it gets a leading apostrophe; quotes are doubled.
 */
export function csvCell(value: string | null | undefined): string {
  let v = (value ?? "").replace(/[\r\n]+/g, " ");
  if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** `trade` turns a template code into its name ("cleaning" becomes "Cleaning"). */
export function leadsCsv(rows: LeadRow[], trade: (code: string) => string): string {
  const lines = rows.map((r) =>
    [
      r.name,
      r.email,
      r.whatsapp,
      r.business_name,
      trade(r.trade),
      r.town,
      r.status,
      r.source,
      r.created_at.slice(0, 16).replace("T", " "),
    ]
      .map(csvCell)
      .join(","),
  );
  // The byte-order mark makes Excel read the file as UTF-8 (names with accents).
  return `﻿${[HEADERS.join(","), ...lines].join("\r\n")}\r\n`;
}
