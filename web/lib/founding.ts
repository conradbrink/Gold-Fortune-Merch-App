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

/**
 * The bands of /founding's form since 25 Oct 2026, then the main page's (since
 * 20 Oct 2026), then the ones before (older applications, and an old page
 * still open).
 */
export const TEAM_SIZES = [
  "1-2",
  "3-5",
  "6-10",
  "11-15",
  "16-30",
  "31+",
  "1-4",
  "5-10",
  "20-50+",
  "11-25",
  "26-50",
  "50+",
] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

/** "Your role" on /founding's form (owner, 25 Oct 2026): who decides. */
export const ROLES = ["owner", "sales_manager", "other"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Their answer to "Tickd may contact me on WhatsApp, phone and email about my
 * pilot": "Yes", "No" (they unticked it: don't contact them), or null when
 * their form didn't ask. /founding's form asks it, ticked to start (owner, 25
 * Oct 2026), and always asks the role, so a role with no consent is a "No".
 */
export function consentAnswer(a: { role: string | null; contact_consent_at: string | null }): "Yes" | "No" | null {
  if (a.contact_consent_at) return "Yes";
  return a.role ? "No" : null;
}

/** A rep band as the form shows it: "3-5" reads "3 to 5", "31+" reads "More than 30". */
export function repsLabel(band: string): string {
  if (band === "31+") return "More than 30";
  return band.replace("-", " to ");
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner or MD",
  sales_manager: "Sales manager",
  other: "Other",
};

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
  // Since 11 Oct 2026 the form asks only these: the applicant's first and last
  // name (sent as one `name`), the business, how many staff, WhatsApp and email.
  name: string;
  businessName: string;
  teamSize: string;
  whatsapp: string;
  email: string;
  /** What they distribute, in their words (asked from 19 Oct 2026; optional here). */
  distributes: string;
  /** Their role (asked on /founding from 25 Oct 2026; optional here, for the main page's form). */
  role: string;
  /** They ticked "Tickd may contact me on WhatsApp, phone and email about my pilot" (/founding, 25 Oct 2026). */
  contactOk: boolean;
  // Everything below was on the longer form until then. Each is optional:
  // checked only when given, so a visitor still on the old form gets through.
  trade: string;
  town: string;
  howRun: string;
  biggestCost: string;
  /** "yes" or "no". */
  wholeTeam: string;
  /** "yes" or "no". */
  videoReview: string;
  marketingOk: boolean;
  source: string;
  /** Where the visitor first came from, as the site recorded it (see checkAttribution). */
  attribution?: unknown;
};

/** A checked application, ready to insert. */
export type FoundingApplication = {
  name: string;
  business_name: string;
  team_size: TeamSize;
  whatsapp: string;
  /** Where we confirm the application; lower case; null when none was given. */
  email: string | null;
  /** What they distribute; null when not asked. */
  distributes: string | null;
  /** Their role; null when not asked. */
  role: Role | null;
  /** When they agreed to be contacted about their pilot; null when not asked. */
  contact_consent_at: string | null;
  /** Null: not asked (the form stopped asking these on 11 Oct 2026). */
  trade: string | null;
  town: string | null;
  how_run: HowRun | null;
  biggest_cost: string | null;
  whole_team: boolean | null;
  video_review: boolean | null;
  /** True when they ticked the consent on the old form; null means no consent yet. */
  marketing_ok: true | null;
  source: string | null;
  attribution: Attribution | null;
};

/**
 * Where an applicant first came from: the advert or site that sent them and
 * the first page they saw. The site keeps this in the visitor's browser from
 * their first visit (no cookie, nothing that names them) and sends it only
 * with an application, which is the point where an anonymous visitor becomes
 * someone we know. It is what later answers "where did our customers come from".
 */
export type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** The other site's host name only, never its full address. */
  referrer?: string;
  /** The path of the first page, without its query. */
  landing_page?: string;
  /** Which kind of ad click brought them ("gclid" is Google Ads, "fbclid" Meta). Never the click's ID. */
  click_id?: "gclid" | "fbclid" | "msclkid" | "ttclid";
  first_seen_at?: string;
};

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const CLICK_IDS = ["gclid", "fbclid", "msclkid", "ttclid"] as const;

/**
 * The attribution the site sent, checked field by field. Anything odd is
 * dropped, never an error: the visitor did nothing wrong, the link just
 * carried something strange. Null when nothing usable is left.
 */
export function checkAttribution(raw: unknown, now: Date = new Date()): Attribution | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t && t.length <= max && !/[\u0000-\u001f\u007f]/.test(t) ? t : undefined;
  };
  const a: Attribution = {};
  for (const key of UTM_KEYS) {
    const v = text(o[key], 100);
    if (v) a[key] = v;
  }
  const referrer = text(o.referrer, 253)?.toLowerCase();
  if (referrer && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(referrer)) a.referrer = referrer;
  const landing = text(o.landing_page, 200);
  if (landing && /^\/[^\s?#]*$/.test(landing)) a.landing_page = landing;
  if ((CLICK_IDS as readonly unknown[]).includes(o.click_id)) a.click_id = o.click_id as Attribution["click_id"];
  const seen = text(o.first_seen_at, 40);
  const seenAt = seen ? Date.parse(seen) : NaN;
  const dayMs = 24 * 60 * 60 * 1000;
  if (!Number.isNaN(seenAt) && seenAt <= now.getTime() + dayMs && seenAt >= now.getTime() - 400 * dayMs) {
    a.first_seen_at = new Date(seenAt).toISOString();
  }
  return Object.keys(a).length > 0 ? a : null;
}

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

/** An email address the database takes too (`founding_applications.email`). */
export function validEmail(raw: string): boolean {
  const e = raw.trim();
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

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
  if (!(TEAM_SIZES as readonly string[]).includes(input.teamSize)) add("teamSize", "Choose how many reps you have.");
  if (input.role && !(ROLES as readonly string[]).includes(input.role)) add("role", "Choose your role.");
  if (normaliseWhatsapp(input.whatsapp) === null) {
    add("whatsapp", "Please enter the WhatsApp number we can reach you on, for example 082 123 4567.");
  }
  // Required on the form; here only checked when given, so an older form is never turned away.
  if (input.email.trim() && !validEmail(input.email)) add("email", "That email address does not look right. Please check it, so we can confirm your application.");
  // No longer on the form; only checked when the old form sends them.
  if (input.distributes.trim().length > 200) add("distributes", "Please keep what you distribute to 200 characters.");
  if (input.trade && !/^[a-z][a-z_]{0,39}$/.test(input.trade)) add("trade", "Choose what your team does.");
  if (input.town.trim().length > 80) add("town", "Please use a shorter town or city name.");
  if (input.howRun && !(HOW_RUN as readonly string[]).includes(input.howRun)) add("howRun", "Choose how you run jobs today.");
  if (input.biggestCost.trim().length > 1000) add("biggestCost", "Please keep this to 1000 characters.");
  if (input.wholeTeam && yesNo(input.wholeTeam) === null) add("wholeTeam", "Please answer yes or no.");
  if (input.videoReview && yesNo(input.videoReview) === null) add("videoReview", "Please answer yes or no.");
  return p;
}

/** The checked application, or the issues. */
export function checkApplication(
  input: FoundingInput,
  now: Date = new Date()
): { ok: true; application: FoundingApplication } | { ok: false; issues: FoundingIssue[] } {
  const issues = foundingIssues(input);
  if (issues.length > 0) return { ok: false, issues };
  const source = input.source.trim().toLowerCase();
  return {
    ok: true,
    application: {
      name: input.name.trim(),
      business_name: input.businessName.trim(),
      team_size: input.teamSize as TeamSize,
      whatsapp: normaliseWhatsapp(input.whatsapp)!,
      email: input.email.trim() ? input.email.trim().toLowerCase() : null,
      distributes: input.distributes.trim() || null,
      role: input.role ? (input.role as Role) : null,
      contact_consent_at: input.contactOk === true ? now.toISOString() : null,
      trade: input.trade || null,
      town: input.town.trim() || null,
      how_run: input.howRun ? (input.howRun as HowRun) : null,
      biggest_cost: input.biggestCost.trim() || null,
      whole_team: yesNo(input.wholeTeam),
      video_review: yesNo(input.videoReview),
      marketing_ok: input.marketingOk === true ? true : null,
      // A source the table would refuse is dropped, not an error: the visitor
      // did nothing wrong, the link just carried something odd.
      source: /^[a-z0-9_-]{1,40}$/.test(source) ? source : null,
      attribution: checkAttribution(input.attribution),
    },
  };
}

const CLICK_LABEL: Record<NonNullable<Attribution["click_id"]>, string> = {
  gclid: "a Google ad",
  fbclid: "Facebook or Instagram",
  msclkid: "a Microsoft ad",
  ttclid: "a TikTok ad",
};

/** One plain line about where an applicant first came from, or null when nothing is known. */
export function describeAttribution(a: Attribution | null | undefined): string | null {
  if (!a) return null;
  const parts: string[] = [];
  const via = [a.utm_source, a.utm_medium].filter(Boolean).join(" / ");
  if (via) parts.push(via);
  if (a.utm_campaign) parts.push(`campaign ${a.utm_campaign}`);
  if (a.utm_term) parts.push(`ad set ${a.utm_term}`);
  if (a.utm_content) parts.push(`ad ${a.utm_content}`);
  if (a.click_id) parts.push(`clicked from ${CLICK_LABEL[a.click_id]}`);
  if (a.referrer) parts.push(`sent by ${a.referrer}`);
  if (!via && !a.click_id && !a.referrer) parts.push("came straight to the site");
  if (a.landing_page) parts.push(`first page ${a.landing_page}`);
  if (a.first_seen_at) parts.push(`first seen ${a.first_seen_at.slice(0, 10)}`);
  return parts.join(", ");
}

/** The fields of an untrusted JSON body, as the right types (anything else becomes "" or false). */
export function inputFromBody(body: unknown): FoundingInput {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return {
    name: s("name"),
    businessName: s("businessName"),
    whatsapp: s("whatsapp"),
    email: s("email"),
    distributes: s("distributes"),
    role: s("role"),
    contactOk: o.contactOk === true,
    trade: s("trade"),
    teamSize: s("teamSize"),
    town: s("town"),
    howRun: s("howRun"),
    biggestCost: s("biggestCost"),
    wholeTeam: s("wholeTeam"),
    videoReview: s("videoReview"),
    marketingOk: o.marketingOk === true,
    source: s("source"),
    attribution: o.attribution,
  };
}

/** The sales site's origins; localhost only outside production, for working on the site. */
export function allowedOrigins(production: boolean): string[] {
  const live = ["https://tickd.co.za", "https://www.tickd.co.za"];
  return production ? live : [...live, "http://localhost:3100", "http://localhost:3110"];
}

/**
 * The sales site's own Vercel previews (project tickd-site, team gold-fortune1),
 * so a change to the form can be tested end to end before it goes live (owner,
 * 25 Oct 2026: "fill in the forms and submit it ... before anything goes
 * live"). They sit behind Vercel's sign-in. Another Vercel project named to
 * look like one could match too; that only lets a browser there read our
 * answer, which costs nothing: the endpoint is public, and its limits still apply.
 */
const SITE_PREVIEW = /^https:\/\/tickd-site-[a-z0-9-]+-gold-fortune1\.vercel\.app$/;

/** The `Access-Control-Allow-Origin` value for this request, or null when the origin is not one of ours. */
export function corsOrigin(origin: string | null, production: boolean): string | null {
  if (!origin) return null;
  return allowedOrigins(production).includes(origin) || SITE_PREVIEW.test(origin) ? origin : null;
}

/** The owner's email about a new application: everything they said, and a link to answer on WhatsApp. */
export function applicationEmail(
  a: FoundingApplication,
  tradeLabel: string | null,
  waitlist: boolean
): { subject: string; html: string; text: string } {
  const about = [tradeLabel, a.town, `${a.team_size} reps`].filter(Boolean).join(", ");
  const subject = `${waitlist ? "Waiting list" : "New Founding application"}: ${a.business_name} (${about})`;
  const link = `https://wa.me/${a.whatsapp}`;
  const yn = (b: boolean) => (b ? "Yes" : "No");
  const notAsked = "(not asked)";
  const rows: [string, string][] = [
    ["Name", a.name],
    ["Business", a.business_name],
    ["What they distribute", a.distributes ?? notAsked],
    ["Reps", repsLabel(a.team_size)],
    ["Role", a.role ? ROLE_LABEL[a.role] : notAsked],
    ["WhatsApp", `+${a.whatsapp}`],
    ["Email", a.email ?? "(none given)"],
    ["Type of work", tradeLabel ?? notAsked],
    ["Town or city", a.town ?? notAsked],
    ["Runs jobs on", a.how_run ? HOW_RUN_LABEL[a.how_run] : notAsked],
    ["Costs them the most", a.biggest_cost ?? notAsked],
    ["Whole team, every workday, 60 days", a.whole_team === null ? notAsked : yn(a.whole_team)],
    ["60-second video and Google review", a.video_review === null ? notAsked : yn(a.video_review)],
    ["Agreed to marketing use", a.marketing_ok ? "Yes" : notAsked],
    ["Agreed to be contacted about the pilot", consentAnswer(a) ?? notAsked],
    ["Came from", a.source ?? "(not known)"],
    ["How they found us", describeAttribution(a.attribution) ?? "(not known)"],
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
