import { checkAttribution, repsLabel, ROLE_LABEL, type Role } from "@/lib/founding";

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
  trade: string | null;
  town: string | null;
  status: string;
  source: string | null;
  // /founding's form since 25 Oct 2026 (null on older applications).
  role?: string | null;
  team_size?: string | null;
  distributes?: string | null;
  contact_consent_at?: string | null;
  attribution?: unknown;
};

// New columns go at the end, so a sheet built on the old ones still lines up.
const HEADERS = [
  "Name",
  "Email",
  "WhatsApp (with country code)",
  "Business",
  "Type of work",
  "Town or city",
  "Status",
  "Came from",
  "Applied (UTC)",
  "Role",
  "Reps",
  "What they distribute",
  "Agreed to be contacted",
  "Campaign",
  "Ad set",
  "Ad",
];

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
  const lines = rows.map((r) => {
    const t = checkAttribution(r.attribution);
    return [
      r.name,
      r.email,
      r.whatsapp,
      r.business_name,
      r.trade ? trade(r.trade) : null,
      r.town,
      r.status,
      r.source,
      r.created_at.slice(0, 16).replace("T", " "),
      r.role ? (ROLE_LABEL[r.role as Role] ?? r.role) : null,
      r.team_size ? repsLabel(r.team_size) : null,
      r.distributes,
      r.contact_consent_at ? "Yes" : null,
      t?.utm_campaign,
      t?.utm_term,
      t?.utm_content,
    ]
      .map(csvCell)
      .join(",");
  });
  // The byte-order mark makes Excel read the file as UTF-8 (names with accents).
  return `﻿${[HEADERS.join(","), ...lines].join("\r\n")}\r\n`;
}
