/**
 * The Founding 10 application (sales site -> /api/founding): what the form
 * holds, how it is checked, the owner's email about it, and who may call the
 * endpoint from a browser.
 *
 * Pure, so the route and its tests share it. The table checks everything
 * again (supabase/migrations/20261010200000_founding_applications.sql); these
 * checks exist so a visitor hears about a mistake in plain words.
 */

import { escapeHtml } from "@/lib/email/templates";

export const TEAM_SIZES = ["1-2", "3-5", "6-15", "16+"] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

/** What the form posts. Every field arrives as text; none is trusted. */
export type FoundingInput = {
  name: string;
  whatsapp: string;
  businessName: string;
  trade: string;
  teamSize: string;
  headache: string;
  source: string;
};

/** A checked application, ready to insert. */
export type FoundingApplication = {
  name: string;
  whatsapp: string;
  business_name: string;
  trade: string;
  team_size: TeamSize;
  headache: string | null;
  source: string | null;
};

export type FoundingIssue = { field: keyof FoundingInput; message: string };

/**
 * A WhatsApp number as digits in international format, or null when it cannot
 * be one. A number that starts with 0 is taken as South African (27), the way
 * an owner types their own number; anything else must carry its country code
 * (with or without a + or 00).
 */
export function normaliseWhatsapp(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  let n: string;
  if (trimmed.startsWith("+")) n = digits;
  else if (digits.startsWith("00")) n = digits.slice(2);
  else if (digits.startsWith("0")) n = `27${digits.slice(1)}`;
  else n = digits;
  return /^[1-9][0-9]{8,14}$/.test(n) ? n : null;
}

/** The first address in `x-forwarded-for`, else the platform's own header. Only ever a rate-limit key. */
export { clientAddress } from "@/lib/signup";

/** Every problem, with the field it belongs to, in the order the person meets them. */
export function foundingIssues(input: FoundingInput): FoundingIssue[] {
  const p: FoundingIssue[] = [];
  const add = (field: keyof FoundingInput, message: string) => p.push({ field, message });
  const name = input.name.trim();
  if (!name) add("name", "Please enter your first name.");
  else if (name.length > 80) add("name", "Please use a shorter name.");
  if (normaliseWhatsapp(input.whatsapp) === null) {
    add("whatsapp", "Please enter the WhatsApp number we can reach you on, for example 082 123 4567.");
  }
  const business = input.businessName.trim();
  if (!business) add("businessName", "Please enter your business's name.");
  else if (business.length > 120) add("businessName", "Please use a shorter business name.");
  if (!/^[a-z][a-z_]{0,39}$/.test(input.trade)) add("trade", "Choose what your team does.");
  if (!(TEAM_SIZES as readonly string[]).includes(input.teamSize)) add("teamSize", "Choose how many people work on site.");
  if (input.headache.trim().length > 1000) add("headache", "Please keep this to 1000 characters.");
  return p;
}

/** The checked application, or the issues. */
export function checkApplication(
  input: FoundingInput
): { ok: true; application: FoundingApplication } | { ok: false; issues: FoundingIssue[] } {
  const issues = foundingIssues(input);
  if (issues.length > 0) return { ok: false, issues };
  const source = input.source.trim().toLowerCase();
  return {
    ok: true,
    application: {
      name: input.name.trim(),
      whatsapp: normaliseWhatsapp(input.whatsapp)!,
      business_name: input.businessName.trim(),
      trade: input.trade,
      team_size: input.teamSize as TeamSize,
      headache: input.headache.trim() || null,
      // A source the table would refuse is dropped, not an error: the visitor
      // did nothing wrong, the link just carried something odd.
      source: /^[a-z0-9_-]{1,40}$/.test(source) ? source : null,
    },
  };
}

/** The text fields of an untrusted JSON body, as strings (anything else becomes ""). */
export function inputFromBody(body: unknown): FoundingInput {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return {
    name: s("name"),
    whatsapp: s("whatsapp"),
    businessName: s("businessName"),
    trade: s("trade"),
    teamSize: s("teamSize"),
    headache: s("headache"),
    source: s("source"),
  };
}

/** The sales site's origins; localhost only outside production, for working on the site. */
export function allowedOrigins(production: boolean): string[] {
  const live = ["https://tickd.co.za", "https://www.tickd.co.za"];
  return production ? live : [...live, "http://localhost:3100"];
}

/** The `Access-Control-Allow-Origin` value for this request, or null when the origin is not one of ours. */
export function corsOrigin(origin: string | null, production: boolean): string | null {
  return origin && allowedOrigins(production).includes(origin) ? origin : null;
}

/** The owner's email about a new application: what they said, and a link to answer on WhatsApp. */
export function applicationEmail(
  a: FoundingApplication,
  tradeLabel: string,
  waitlist: boolean
): { subject: string; html: string; text: string } {
  const where = waitlist ? "waiting list" : "Founding 10";
  const subject = `${waitlist ? "Waiting list" : "New Founding application"}: ${a.business_name} (${tradeLabel}, ${a.team_size} on site)`;
  const link = `https://wa.me/${a.whatsapp}`;
  const rows: [string, string][] = [
    ["Name", a.name],
    ["WhatsApp", `+${a.whatsapp}`],
    ["Business", a.business_name],
    ["Type of work", tradeLabel],
    ["People on site", a.team_size],
    ["Biggest headache", a.headache ?? "(not filled in)"],
    ["Came from", a.source ?? "(not known)"],
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#f7f7f2;font-family:Arial,Helvetica,sans-serif;color:#14211e">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:12px;padding:24px;line-height:1.5;font-size:15px">
<h1 style="margin:0 0 12px;font-size:20px">${waitlist ? "Someone joined the waiting list" : "A new application for the Founding 10"}</h1>
<table style="border-collapse:collapse;width:100%">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5b6b66;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`
    )
    .join("")}</table>
<p style="margin:24px 0 0"><a href="${link}" style="background:#0f3d3e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Reply on WhatsApp</a></p>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#5b6b66">Saved in the ${where} list (founding_applications).</p>
</div></body></html>`;
  const text = [
    waitlist ? "Someone joined the waiting list." : "A new application for the Founding 10.",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `Reply on WhatsApp: ${link}`,
  ].join("\n");
  return { subject, html, text };
}
