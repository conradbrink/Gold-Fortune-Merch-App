/**
 * Where a new Founding application goes besides the owner's email (owner, 25
 * Oct 2026: Conrad calls every lead within minutes):
 *
 *   - a Telegram message to the owner, from their own bot (Telegram's Bot
 *     API). Set TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID
 *     (the owner's chat with the bot); see docs/LEADS-SHEET.md. The owner's
 *     choice of 25 Oct 2026, while CallMeBot took no new numbers.
 *   - a WhatsApp message to the owner, through CallMeBot (callmebot.com). The
 *     owner gets the key by messaging CallMeBot once from their own WhatsApp;
 *     set CALLMEBOT_PHONE (their number, digits only) and CALLMEBOT_APIKEY.
 *   - a row in the owner's Google Sheet, through the Apps Script in
 *     docs/LEADS-SHEET.md; set LEADS_SHEET_URL (the script's web app link) and
 *     LEADS_SHEET_SECRET (the same secret word as in the script).
 *
 * Each is off while its settings are empty, and neither ever throws: the
 * application is already saved, and the owner's email still goes.
 */

import { escapeHtml } from "@/lib/email/templates";
import { consentAnswer, describeAttribution, repsLabel, ROLE_LABEL, type FoundingApplication } from "@/lib/founding";
import { FOUNDING_OFFER } from "@/lib/founding-offer";

/** Who calls each lead (the site's `founding.caller`), for the first WhatsApp the card drafts. */
const CALLER = "Conrad";

/** The owner's message about a new application (Telegram or WhatsApp): who, how big, and a link to answer. */
export function alertText(a: FoundingApplication, waitlist: boolean): string {
  const lines = [
    `${waitlist ? "Waiting list" : "New Founding lead"}: ${a.name}, ${a.business_name}`,
    `Reps: ${a.team_size}${a.role ? ` · ${ROLE_LABEL[a.role]}` : ""}`,
    `WhatsApp: +${a.whatsapp}`,
    a.distributes ? `Distributes: ${a.distributes}` : null,
    a.email ? `Email: ${a.email}` : null,
    `From: ${describeAttribution(a.attribution) ?? "not known"}`,
    `Answer: https://wa.me/${a.whatsapp}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** Where the lead came from, in one line: source, campaign, ad set and ad when the link carried them. */
export function cameFrom(a: FoundingApplication): string {
  const t = a.attribution;
  const parts = [
    [t?.utm_source, t?.utm_medium].filter(Boolean).join(" / "),
    t?.utm_campaign ? `campaign ${t.utm_campaign}` : "",
    t?.utm_term ? `ad set ${t.utm_term}` : "",
    t?.utm_content ? `ad ${t.utm_content}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : (describeAttribution(t) ?? "not known");
}

/** wa.me with a first message ready to send (the owner can change it first). */
export function whatsappLink(a: FoundingApplication): string {
  const first = a.name.split(/\s+/)[0] ?? "";
  const hello =
    `Hi ${first}, it's ${CALLER} from Tickd. Thanks for applying for the free ${FOUNDING_OFFER.pilotDays}-day pilot. ` +
    "Is now a good time for a quick call?";
  // encodeURIComponent leaves ' as it is; %27 keeps the link clean inside the card's HTML.
  return `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(hello).replace(/'/g, "%27")}`;
}

/**
 * The owner's Telegram card about a new application (owner, 25 Oct 2026:
 * "give me information on the client ... then I can give them a WhatsApp"):
 * every answer on the form, when, where from, and a link that opens WhatsApp
 * with a first message. Telegram's HTML: only <b> and <a>, everything typed
 * by the applicant escaped.
 */
export function telegramCard(a: FoundingApplication, waitlist: boolean, at: Date): string {
  const e = escapeHtml;
  const first = a.name.split(/\s+/)[0] ?? a.name;
  const row = (label: string, value: string | null | undefined) => (value ? `${label}: ${e(value)}` : null);
  const lines = [
    waitlist ? "🕒 <b>Waiting list</b> (all spots taken)" : "🔔 <b>New Founding lead</b>",
    `<b>${e(a.name)}</b> · ${e(a.business_name)}`,
    "",
    row("Role", a.role ? ROLE_LABEL[a.role] : null),
    row("Reps", repsLabel(a.team_size)),
    row("Distributes", a.distributes),
    row("WhatsApp", `+${a.whatsapp}`),
    row("Email", a.email),
    consentAnswer(a) === "No"
      ? "⚠️ <b>Agreed to be contacted: No</b> (they unticked it)"
      : row("Agreed to be contacted", consentAnswer(a)),
    row("Applied", `${saTime(at)} (SA time)`),
    row("Came from", cameFrom(a)),
    "",
    `💬 <a href="${e(whatsappLink(a))}">WhatsApp ${e(first)}</a>`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** The time in South Africa, to the second, the way a sheet reads it: "2026-10-25 10:14:03". */
export function saTime(at: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(at);
}

/**
 * The sheet's columns, in order: when, every answer on the form, the ad's tags
 * (Meta's ad set goes in utm_term when the ad links carry it), then the
 * owner's own columns, left empty for them to fill in.
 */
export const SHEET_HEADERS = [
  "Submitted (SA time)",
  "Name",
  "Business",
  "WhatsApp",
  "Reps",
  "Role",
  "What they distribute",
  "Email",
  "Agreed to be contacted",
  "List",
  "Source",
  "Campaign",
  "Ad set",
  "Ad",
  "First call at",
  "Reached",
  "Score",
  "Sales call booked",
  "Notes",
] as const;

/** One application as a row under SHEET_HEADERS. */
export function sheetRow(a: FoundingApplication, waitlist: boolean, at: Date): string[] {
  const t = a.attribution ?? {};
  return [
    saTime(at),
    a.name,
    a.business_name,
    `+${a.whatsapp}`,
    a.team_size,
    a.role ? ROLE_LABEL[a.role] : "",
    a.distributes ?? "",
    a.email ?? "",
    consentAnswer(a) ?? "",
    waitlist ? "Waiting list" : "Founding",
    [t.utm_source, t.utm_medium].filter(Boolean).join(" / "),
    t.utm_campaign ?? "",
    t.utm_term ?? "",
    t.utm_content ?? "",
    "",
    "",
    "",
    "",
    "",
  ];
}

const TIMEOUT_MS = 8000;

/** A setting from Vercel, without the space or line break a pasted value can carry; "" when unset. */
const setting = (name: string): string => process.env[name]?.trim() ?? "";

/** Sends the owner a Telegram card about a new application, when their bot is set up. */
export async function alertOwnerOnTelegram(
  id: string,
  a: FoundingApplication,
  waitlist: boolean,
  at: Date
): Promise<void> {
  const token = setting("TELEGRAM_BOT_TOKEN");
  const chat = setting("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: telegramCard(a, waitlist, at),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Telegram says why (a wrong chat, or the owner never pressed Start); never the token.
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      console.error("founding: the owner's Telegram was not sent", id, res.status, body?.description ?? "");
    }
  } catch (e) {
    // A failed fetch's message can carry the address, and the address carries the token.
    console.error("founding: the owner's Telegram failed", id, e instanceof Error ? e.name : "error");
  }
}

/** WhatsApps the owner about a new application, when CallMeBot is set up. */
export async function alertOwnerOnWhatsapp(id: string, a: FoundingApplication, waitlist: boolean): Promise<void> {
  const phone = setting("CALLMEBOT_PHONE").replace(/\D/g, "");
  const key = setting("CALLMEBOT_APIKEY");
  if (!phone || !key) return;
  try {
    const url = new URL("https://api.callmebot.com/whatsapp.php");
    url.searchParams.set("phone", phone);
    url.searchParams.set("text", alertText(a, waitlist));
    url.searchParams.set("apikey", key);
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) console.error("founding: the owner's WhatsApp was not sent", id, res.status);
  } catch (e) {
    console.error("founding: the owner's WhatsApp failed", id, e instanceof Error ? e.message : e);
  }
}

/** Adds the application to the owner's Google Sheet, when it is set up. */
export async function addToLeadsSheet(id: string, a: FoundingApplication, waitlist: boolean, at: Date): Promise<void> {
  const url = setting("LEADS_SHEET_URL");
  const secret = setting("LEADS_SHEET_SECRET");
  if (!url || !secret) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, headers: SHEET_HEADERS, row: sheetRow(a, waitlist, at) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || body?.ok !== true) {
      console.error("founding: the lead was not added to the sheet", id, res.status, body?.error ?? "");
    }
  } catch (e) {
    console.error("founding: the lead sheet failed", id, e instanceof Error ? e.message : e);
  }
}
