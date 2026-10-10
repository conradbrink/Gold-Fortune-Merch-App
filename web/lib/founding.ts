/**
 * The Founding 10 application (sales site /founding -> /api/founding): what
 * the form holds, how it is checked, the owner's email about it, and who may
 * call the endpoint from a browser.
 *
 * Pure, so the route and its tests share it. The table checks everything
 * again (supabase/migrations/20261010200000_founding_applications.sql); these
 * checks exist so a visitor hears about a mistake in plain words.
 */

import { escapeHtml } from "@/lib/email/templates";

export const TEAM_SIZES = ["1-4", "5-10", "11-25", "26-50", "50+"] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

export const HOW_RUN = ["whatsapp", "paper", "app", "memory"] as const;
export type HowRun = (typeof HOW_RUN)[number];

/** How each answer to "How do you run jobs today?" reads in the owner's email. */
export const HOW_RUN_LABEL: Record<HowRun, string> = {
  whatsapp: "WhatsApp",
  paper: "Paper",
  app: "Another app",
  memory: "Mostly memory",
};

/** What the form posts. Every field arrives as text or a yes/no; none is trusted. */
export type FoundingInput = {
  name: string;
  businessName: string;
  whatsapp: string;
  trade: string;
  teamSize: string;
  town: string;
  howRun: string;
  biggestCost: string;
  /** "yes" or "no". */
  wholeTeam: string;
  /** "yes" or "no". */
  videoReview: string;
  marketingOk: boolean;
  source: string;
};

/** A checked application, ready to insert. */
export type FoundingApplication = {
  name: string;
  business_name: string;
  whatsapp: string;
  trade: string;
  team_size: TeamSize;
  town: string;
  how_run: HowRun;
  biggest_cost: string;
  whole_team: boolean;
  video_review: boolean;
  marketing_ok: true;
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

const yesNo = (v: string): boolean | null => (v === "yes" ? true : v === "no" ? false : null);

/** Every problem, with the field it belongs to, in the order the form shows the fields. */
export function foundingIssues(input: FoundingInput): FoundingIssue[] {
  const p: FoundingIssue[] = [];
  const add = (field: keyof FoundingInput, message: string) => p.push({ field, message });
  const name = input.name.trim();
  if (!name) add("name", "Please enter your name.");
  else if (name.length > 80) add("name", "Please use a shorter name.");
  const business = input.businessName.trim();
  if (!business) add("businessName", "Please enter your business's name.");
  else if (business.length > 120) add("businessName", "Please use a shorter business name.");
  if (normaliseWhatsapp(input.whatsapp) === null) {
    add("whatsapp", "Please enter the WhatsApp number we can reach you on, for example 082 123 4567.");
  }
  if (!/^[a-z][a-z_]{0,39}$/.test(input.trade)) add("trade", "Choose what your team does.");
  if (!(TEAM_SIZES as readonly string[]).includes(input.teamSize)) add("teamSize", "Choose how many people work in the field.");
  const town = input.town.trim();
  if (!town) add("town", "Please enter your town or city.");
  else if (town.length > 80) add("town", "Please use a shorter town or city name.");
  if (!(HOW_RUN as readonly string[]).includes(input.howRun)) add("howRun", "Choose how you run jobs today.");
  const cost = input.biggestCost.trim();
  if (!cost) add("biggestCost", "Please tell us what costs you the most right now.");
  else if (cost.length > 1000) add("biggestCost", "Please keep this to 1000 characters.");
  if (yesNo(input.wholeTeam) === null) add("wholeTeam", "Please answer yes or no.");
  if (yesNo(input.videoReview) === null) add("videoReview", "Please answer yes or no.");
  if (input.marketingOk !== true) add("marketingOk", "Please tick the box to agree, or we can't take your application.");
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
      business_name: input.businessName.trim(),
      whatsapp: normaliseWhatsapp(input.whatsapp)!,
      trade: input.trade,
      team_size: input.teamSize as TeamSize,
      town: input.town.trim(),
      how_run: input.howRun as HowRun,
      biggest_cost: input.biggestCost.trim(),
      whole_team: yesNo(input.wholeTeam)!,
      video_review: yesNo(input.videoReview)!,
      marketing_ok: true,
      // A source the table would refuse is dropped, not an error: the visitor
      // did nothing wrong, the link just carried something odd.
      source: /^[a-z0-9_-]{1,40}$/.test(source) ? source : null,
    },
  };
}

/** The fields of an untrusted JSON body, as the right types (anything else becomes "" or false). */
export function inputFromBody(body: unknown): FoundingInput {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return {
    name: s("name"),
    businessName: s("businessName"),
    whatsapp: s("whatsapp"),
    trade: s("trade"),
    teamSize: s("teamSize"),
    town: s("town"),
    howRun: s("howRun"),
    biggestCost: s("biggestCost"),
    wholeTeam: s("wholeTeam"),
    videoReview: s("videoReview"),
    marketingOk: o.marketingOk === true,
    source: s("source"),
  };
}

/** The sales site's origins; localhost only outside production, for working on the site. */
export function allowedOrigins(production: boolean): string[] {
  const live = ["https://tickd.co.za", "https://www.tickd.co.za"];
  return production ? live : [...live, "http://localhost:3100", "http://localhost:3110"];
}

/** The `Access-Control-Allow-Origin` value for this request, or null when the origin is not one of ours. */
export function corsOrigin(origin: string | null, production: boolean): string | null {
  return origin && allowedOrigins(production).includes(origin) ? origin : null;
}

/** The owner's email about a new application: everything they said, and a link to answer on WhatsApp. */
export function applicationEmail(
  a: FoundingApplication,
  tradeLabel: string,
  waitlist: boolean
): { subject: string; html: string; text: string } {
  const subject = `${waitlist ? "Waiting list" : "New Founding application"}: ${a.business_name} (${tradeLabel}, ${a.town}, ${a.team_size} in the field)`;
  const link = `https://wa.me/${a.whatsapp}`;
  const yn = (b: boolean) => (b ? "Yes" : "No");
  const rows: [string, string][] = [
    ["Name", a.name],
    ["Business", a.business_name],
    ["WhatsApp", `+${a.whatsapp}`],
    ["Type of work", tradeLabel],
    ["People in the field", a.team_size],
    ["Town or city", a.town],
    ["Runs jobs on", HOW_RUN_LABEL[a.how_run]],
    ["Costs them the most", a.biggest_cost],
    ["Whole team, every workday, 60 days", yn(a.whole_team)],
    ["60-second video and Google review", yn(a.video_review)],
    ["Agreed to marketing use", yn(a.marketing_ok)],
    ["Came from", a.source ?? "(not known)"],
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#f7f7f2;font-family:Arial,Helvetica,sans-serif;color:#14211e">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:12px;padding:24px;line-height:1.5;font-size:15px">
<h1 style="margin:0 0 12px;font-size:20px">${waitlist ? "Someone joined the waiting list" : "A new application for the Founding 10"}</h1>
<table style="border-collapse:collapse;width:100%">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5b6b66;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`
    )
    .join("")}</table>
<p style="margin:24px 0 0"><a href="${link}" style="background:#0f3d3e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Reply on WhatsApp</a></p>
</div>
<p style="margin:16px 0 0;font-size:12px;color:#5b6b66">Saved in the list at app.tickd.co.za/platform/founding.</p>
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
