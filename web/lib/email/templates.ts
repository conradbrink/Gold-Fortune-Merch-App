/**
 * The emails Tickd sends for a company, rendered at send time from the
 * outbox row's template and payload. One plain layout for all of them: the
 * company's name at the top (its letterhead is its own; Tickd is the
 * postman), the message, and a way to stop them at the foot.
 *
 * Plain HTML with inline styles and a text part, because email clients
 * strip most of what a web page would use.
 */

import { alertHref, alertText, dayText, type AlertItem } from "@/lib/alerts";
import { parseTerms } from "@/lib/terms";
import { PROMO, TICKD_LOGO_FILE, emailAssetUrl } from "@/lib/email/brand";
import { ageingParts, amountText, dayText as dateText, overdueText, periodText } from "@/lib/client-document";

export type EmailContext = {
  companyName: string;
  /** Where "stop these emails" goes; null for mail to the company's own people. */
  unsubscribeUrl: string | null;
  /** The document's PDF is attached to this email. */
  attached?: boolean;
  /** Replies reach the company (it has an email address on its profile). */
  canReply?: boolean;
  /** The company's own logo, a public address, shown at the top in place of its name. */
  companyLogoUrl?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The shared frame: heading, body paragraphs (already HTML), optional button, footer. */
export function layout(
  ctx: EmailContext,
  parts: {
    heading: string;
    bodyHtml: string;
    bodyText: string;
    button?: { label: string; url: string };
    /** The line some mail programs show beside the subject. */
    preheader?: string;
    /** The sign-off, after the button. */
    closing?: { html: string; text: string };
  }
): { html: string; text: string } {
  const company = escapeHtml(ctx.companyName);
  // An email to a company's clients carries Tickd's name and a short advert;
  // one to the company's own people (alerts, tests) does not.
  const toClients = ctx.unsubscribeUrl !== null;
  const button = parts.button
    ? `<p style="margin:26px 0 0"><a href="${escapeHtml(parts.button.url)}" style="background:#0f5c4f;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:8px;display:inline-block;font-weight:700;font-size:15px">${escapeHtml(parts.button.label)}</a></p>`
    : "";
  // The company's own logo when it has one (its name is the picture's text for a
  // program that does not load pictures); otherwise its name.
  const companyMark = ctx.companyLogoUrl
    ? `<img src="${escapeHtml(ctx.companyLogoUrl)}" alt="${company}" style="display:block;border:0;width:auto;height:auto;max-width:200px;max-height:56px">`
    : company;
  const small = (text: string) => `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#5b6b66">${text}</p>`;
  const attachedHtml = ctx.attached ? small("The PDF is attached to this email.") : "";
  const replyHtml = toClients && ctx.canReply ? small(`Questions? Just reply to this email and it will reach ${company}.`) : "";
  const stop = ctx.unsubscribeUrl
    ? ` <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#5b6b66">Stop these emails</a>.`
    : "";
  const preheader = parts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${escapeHtml(parts.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>`
    : "";
  const promoHtml = toClients
    ? `<tr><td style="padding:16px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dfe7e4;border-radius:12px"><tr><td style="padding:20px 22px">
<a href="${escapeHtml(PROMO.url)}" style="text-decoration:none"><img src="${escapeHtml(emailAssetUrl(TICKD_LOGO_FILE))}" width="112" height="41" alt="Tickd" style="display:block;border:0;height:auto;margin:0 0 12px"></a>
<p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#14211e">${escapeHtml(PROMO.headline)}</p>
<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#44554f">${escapeHtml(PROMO.body)}</p>
<a href="${escapeHtml(PROMO.url)}" style="font-size:13px;font-weight:700;color:#0f5c4f;text-decoration:underline">${escapeHtml(PROMO.cta)}</a>
</td></tr></table></td></tr>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(parts.heading)}</title></head><body style="margin:0;padding:0;background:#eef2f1;font-family:Arial,Helvetica,sans-serif;color:#14211e">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f1"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font-size:15px;font-weight:700">${companyMark}</td></tr>
<tr><td style="background:#ffffff;border-radius:12px;border-top:4px solid #0f5c4f;padding:28px 24px;line-height:1.55;font-size:15px">
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3">${escapeHtml(parts.heading)}</h1>
${parts.bodyHtml}
${button}${parts.closing?.html ?? ""}${attachedHtml}${replyHtml}
</td></tr>
${promoHtml}
<tr><td style="padding:16px 4px 0;font-size:12px;color:#5b6b66;line-height:1.5">Sent for ${company} by Tickd.${stop}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    ctx.companyName,
    "",
    parts.heading,
    "",
    parts.bodyText,
    parts.button ? `\n${parts.button.label}: ${parts.button.url}` : "",
    parts.closing ? `\n${parts.closing.text}` : "",
    ctx.attached ? "\nThe PDF is attached to this email." : "",
    toClients && ctx.canReply ? `\nQuestions? Just reply to this email and it will reach ${ctx.companyName}.` : "",
    toClients ? `\n---\n${PROMO.headline} ${PROMO.body}\n${PROMO.cta}: ${PROMO.url}\n---` : "",
    "",
    `Sent for ${ctx.companyName} by Tickd.${ctx.unsubscribeUrl ? ` Stop these emails: ${ctx.unsubscribeUrl}` : ""}`,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
  return { html, text };
}

type Renderer = (payload: Record<string, unknown>, ctx: EmailContext) => RenderedEmail;

/** One job in a report email, as the sender looked it up (job_report_view) with its signed link. */
export type ReportLine = {
  url: string;
  siteName: string;
  staffName: string | null;
  day: string;
  timeIn: string;
  timeOut: string;
  photos: number;
  onSite: boolean | null;
  jobWord: string;
};

function reportLines(payload: Record<string, unknown>): ReportLine[] {
  return Array.isArray(payload.reports) ? (payload.reports as ReportLine[]) : [];
}

function lineText(l: ReportLine): string {
  const where = l.onSite === null ? "" : l.onSite ? ", checked in on site" : ", checked in away from the site";
  const photos = l.photos === 1 ? "1 photo" : `${l.photos} photos`;
  return `${l.timeIn} to ${l.timeOut}${l.staffName ? `, ${l.staffName}` : ""}${where}, ${photos}`;
}

function alertsOf(payload: Record<string, unknown>): AlertItem[] {
  return Array.isArray(payload.alerts) ? (payload.alerts as AlertItem[]) : [];
}

/** The company's words and clock from the payload, and the app's address the sender added. */
function alertContext(payload: Record<string, unknown>) {
  return {
    terms: parseTerms(payload.terms),
    timeZone: typeof payload.timezone === "string" && payload.timezone ? payload.timezone : "UTC",
    appUrl: (typeof payload.app_url === "string" && payload.app_url ? payload.app_url : "https://app.tickd.co.za").replace(/\/$/, ""),
  };
}

// ------------------------------------------------------- money documents

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Text a person typed, safe in HTML, with its line breaks kept. */
function htmlLines(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

/** The sender's optional note, as a quoted line under who it is from; nothing when there is none. */
function noteBlock(payload: Record<string, unknown>, company: string): { html: string; text: string } {
  const note = str(payload.note);
  if (!note) return { html: "", text: "" };
  return {
    html: `<p style="margin:18px 0 6px;font-size:12px;color:#5b6b66;text-transform:uppercase;letter-spacing:.04em">A note from ${escapeHtml(company)}</p><p style="margin:0;padding:12px 14px;background:#f2f6f5;border-left:3px solid #0f5c4f;border-radius:6px;font-style:italic;color:#2f3f3b">${htmlLines(note)}</p>`,
    text:
      `A note from ${company}:\n` +
      note
        .split(/\r?\n/)
        .map((l) => `> ${l}`)
        .join("\n"),
  };
}

type Fact = { label: string; value: string; strong?: boolean };

/** The few figures an email is about: a shaded card, the first (strong) one large. */
function factsBlock(facts: Fact[]): { html: string; text: string } {
  const [first, ...rest] = facts;
  if (!first) return { html: "", text: "" };
  const hero = first.strong
    ? `<p style="margin:0;font-size:12px;color:#5b6b66;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(first.label)}</p><p style="margin:2px 0 0;font-size:28px;line-height:1.2;font-weight:700;color:#0f5c4f">${escapeHtml(first.value)}</p>`
    : "";
  const rows = (first.strong ? rest : facts)
    .map(
      (f) =>
        `<tr><td style="padding:5px 16px 5px 0;color:#5b6b66;vertical-align:top;font-size:14px">${escapeHtml(f.label)}</td><td style="padding:5px 0;font-weight:600;font-size:14px">${escapeHtml(f.value)}</td></tr>`
    )
    .join("");
  const table = rows ? `<table role="presentation" style="margin:${first.strong ? "10px" : "0"} 0 0;border-collapse:collapse">${rows}</table>` : "";
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:#f2f6f5;border-radius:10px"><tr><td style="padding:16px 18px">${hero}${table}</td></tr></table>`,
    text: facts.map((f) => `${f.label}: ${f.value}`).join("\n"),
  };
}

/** Pieces stacked into one email body: HTML paragraphs and their plain text. */
function stack(parts: { html: string; text: string }[]): { html: string; text: string } {
  const used = parts.filter((p) => p.html || p.text);
  return { html: used.map((p) => p.html).join(""), text: used.map((p) => p.text).join("\n\n") };
}

const para = (text: string, first = false) => ({
  html: `<p style="margin:${first ? "0" : "16px 0 0"}">${htmlLines(text)}</p>`,
  text,
});

/** Who the email is from: the company in the payload, else the one it is sent for. */
const fromCompany = (payload: Record<string, unknown>, ctx: EmailContext) => str(payload.company_name) || ctx.companyName;

function documentEmail(
  ctx: EmailContext,
  payload: Record<string, unknown>,
  email: { subject: string; preheader?: string; heading: string; body: { html: string; text: string }; closing?: { html: string; text: string }; button: string }
): RenderedEmail {
  const url = str(payload.url);
  if (!url) throw new Error("A document email needs the link to its page.");
  const { html, text } = layout(ctx, {
    heading: email.heading,
    preheader: email.preheader,
    bodyHtml: email.body.html,
    bodyText: email.body.text,
    closing: email.closing,
    button: { label: email.button, url },
  });
  return { subject: email.subject, html, text };
}

const TEMPLATES: Record<string, Renderer> = {
  // One finished job, as it is finished.
  job_report: (payload, ctx) => {
    const l = reportLines(payload)[0];
    if (!l) throw new Error("A job report email needs its report.");
    const job = l.jobWord.toLowerCase();
    const facts: Fact[] = [
      { label: "Where", value: l.siteName },
      { label: "Day", value: l.day },
      { label: "Time", value: `${l.timeIn} to ${l.timeOut}` },
      ...(l.staffName ? [{ label: "Done by", value: l.staffName }] : []),
      ...(l.onSite === null ? [] : [{ label: "Check-in", value: l.onSite ? "On site" : "Away from the site" }]),
      { label: "Photos", value: String(l.photos) },
    ];
    const { html, text } = layout(ctx, {
      heading: `${l.jobWord} done at ${l.siteName}`,
      preheader: `${l.day}, ${l.timeIn} to ${l.timeOut}`,
      bodyHtml: stack([
        para("Hello,", true),
        para(`The ${job} at ${l.siteName} is done. Here are the details.`),
        factsBlock(facts),
        para(`See the checklist and photos, and sign it off if you are happy with the ${job}.`),
      ]).html,
      bodyText: stack([
        para("Hello,", true),
        para(`The ${job} at ${l.siteName} is done. Here are the details.`),
        factsBlock(facts),
        para(`See the checklist and photos, and sign it off if you are happy with the ${job}.`),
      ]).text,
      button: { label: "See the report and sign", url: l.url },
    });
    return { subject: `${l.jobWord} done at ${l.siteName}, ${l.day}`, html, text };
  },
  // A site's evening email: every job finished since the last one. A job
  // finished after last night's email, or across midnight, can be from
  // yesterday; then each line says its day.
  job_reports_day: (payload, ctx) => {
    const lines = reportLines(payload);
    const first = lines[0];
    if (!first) throw new Error("A day's report email needs its reports.");
    const jobs = lines.length === 1 ? first.jobWord.toLowerCase() : `${first.jobWord.toLowerCase()}s`;
    const oneDay = lines.every((l) => l.day === first.day);
    const when = oneDay ? `on ${first.day}` : "since the last report";
    const text = (l: ReportLine) => (oneDay ? lineText(l) : `${l.day}, ${lineText(l)}`);
    const items = lines
      .map((l) => `<li style="margin:0 0 10px">${escapeHtml(text(l))}. <a href="${escapeHtml(l.url)}" style="color:#0f5c4f;font-weight:600">See and sign</a></li>`)
      .join("");
    const intro = `${lines.length} ${jobs} done at ${first.siteName} ${when}:`;
    const { html, text: bodyText } = layout(ctx, {
      heading: oneDay ? `${first.siteName}, ${first.day}` : first.siteName,
      preheader: `${lines.length} ${jobs} done ${when}`,
      bodyHtml: `<p style="margin:0">Hello,</p><p style="margin:16px 0 0">${escapeHtml(intro)}</p><ul style="margin:12px 0 0;padding-left:20px">${items}</ul><p style="margin:16px 0 0">Open any of them to see the checklist and photos, and to sign it off.</p>`,
      bodyText: `Hello,\n\n${intro}\n${lines.map((l) => `- ${text(l)}. See and sign: ${l.url}`).join("\n")}\n\nOpen any of them to see the checklist and photos, and to sign it off.`,
    });
    return { subject: `${first.siteName}: ${lines.length} ${jobs} done ${when}`, html, text: bodyText };
  },
  // One alert, as it is found (alerts_email "instant"). To the company's own
  // people, so no unsubscribe link: the setting is theirs to change.
  alert: (payload, ctx) => {
    const a = alertsOf(payload)[0];
    if (!a) throw new Error("An alert email needs its alert.");
    const { terms, timeZone, appUrl } = alertContext(payload);
    const { title, body } = alertText(a, terms, timeZone);
    const { html, text } = layout(ctx, {
      heading: title,
      bodyHtml: `<p style="margin:0">${escapeHtml(body)}</p>`,
      bodyText: body,
      button: { label: "See it in Tickd", url: `${appUrl}${alertHref(a, null)}` },
    });
    return { subject: `${title}: ${a.site_name?.trim() || ctx.companyName}`, html, text };
  },
  // The day's alerts in one email (alerts_email "digest").
  alerts_digest: (payload, ctx) => {
    const list = alertsOf(payload);
    if (list.length === 0) throw new Error("A day's alert email needs its alerts.");
    const { terms, timeZone, appUrl } = alertContext(payload);
    const total = typeof payload.total === "number" && payload.total > list.length ? payload.total : list.length;
    const day = typeof payload.day === "string" ? dayText(payload.day) : "Today";
    const lines = list.map((a) => ({ ...alertText(a, terms, timeZone), url: `${appUrl}${alertHref(a, null)}` }));
    const more = total > list.length ? total - list.length : 0;
    const things = total === 1 ? "1 thing to check" : `${total} things to check`;
    const items = lines
      .map((l) => `<li style="margin:0 0 10px"><strong>${escapeHtml(l.title)}</strong><br>${escapeHtml(l.body)} <a href="${escapeHtml(l.url)}" style="color:#0f5c4f">See it</a></li>`)
      .join("");
    const moreLine = more > 0 ? `And ${more} more in Tickd.` : "";
    const { html, text } = layout(ctx, {
      heading: `${things}, ${day}`,
      bodyHtml: `<ul style="margin:0;padding-left:20px">${items}</ul>${moreLine ? `<p style="margin:8px 0 0">${escapeHtml(moreLine)}</p>` : ""}`,
      bodyText: `${lines.map((l) => `- ${l.title}. ${l.body} ${l.url}`).join("\n")}${moreLine ? `\n${moreLine}` : ""}`,
      button: { label: "Open Tickd", url: appUrl },
    });
    return { subject: `${ctx.companyName}: ${things}, ${day}`, html, text };
  },
  // An invoice, with a link to its page (document_link_view).
  invoice: (payload, ctx) => {
    const number = str(payload.number);
    if (!number) throw new Error("An invoice email needs the invoice number.");
    const company = fromCompany(payload, ctx);
    const who = str(payload.customer_name);
    const total = amountText(payload.total, payload.currency);
    const due = str(payload.due_date) ? dateText(str(payload.due_date)) : "";
    const facts: Fact[] = [
      { label: "Invoice total", value: total, strong: true },
      ...(due ? [{ label: "Payment due", value: due }] : []),
      ...(str(payload.issue_date) ? [{ label: "Invoice date", value: dateText(str(payload.issue_date)) }] : []),
      ...(str(payload.reference) ? [{ label: "Reference", value: str(payload.reference) }] : []),
    ];
    return documentEmail(ctx, payload, {
      subject: `Invoice ${number} from ${company}`,
      preheader: `${total}${due ? `, due ${due}` : ""}`,
      heading: `Invoice ${number}`,
      body: stack([
        para(`Hello${who ? ` ${who}` : ""},`, true),
        para(`Here is invoice ${number} from ${company}.`),
        factsBlock(facts),
        noteBlock(payload, company),
        para(`The bank details and your payment reference are on the invoice.`),
      ]),
      closing: para(`Thank you,\n${company}`),
      button: "View invoice",
    });
  },
  // A quote, with a link to its page.
  quote: (payload, ctx) => {
    const number = str(payload.number);
    if (!number) throw new Error("A quote email needs the quote number.");
    const company = fromCompany(payload, ctx);
    const who = str(payload.customer_name);
    const total = amountText(payload.total, payload.currency);
    const until = str(payload.valid_until) ? dateText(str(payload.valid_until)) : "";
    const facts: Fact[] = [
      { label: "Quote total", value: total, strong: true },
      ...(until ? [{ label: "Valid until", value: until }] : []),
    ];
    return documentEmail(ctx, payload, {
      subject: `Quote ${number} from ${company}`,
      preheader: `${total}${until ? `, valid until ${until}` : ""}`,
      heading: `Quote ${number}`,
      body: stack([
        para(`Hello${who ? ` ${who}` : ""},`, true),
        para(`Here is quote ${number} from ${company}.`),
        factsBlock(facts),
        noteBlock(payload, company),
        para(ctx.canReply ? "If you are happy with it, just reply to this email and we will get things going." : "If you are happy with it, let us know and we will get things going."),
      ]),
      closing: para(`Kind regards,\n${company}`),
      button: "View quote",
    });
  },
  // A client's statement for a period, with what is owed by age.
  statement: (payload, ctx) => {
    const from = str(payload.from);
    const to = str(payload.to);
    if (!from || !to) throw new Error("A statement email needs its dates.");
    const company = fromCompany(payload, ctx);
    const who = str(payload.client_name);
    const balance = amountText(payload.balance, payload.currency);
    const ageing = ageingParts(payload.ageing as Record<string, number> | undefined);
    const facts: Fact[] = [
      { label: `Balance at ${dateText(to)}`, value: balance, strong: true },
      ...ageing.map((a) => ({ label: a.label, value: amountText(a.amount, payload.currency) })),
    ];
    return documentEmail(ctx, payload, {
      subject: `Statement from ${company}, ${periodText(from, to)}`,
      preheader: `${balance} at ${dateText(to)}`,
      heading: "Your statement",
      body: stack([
        para(`Hello${who ? ` ${who}` : ""},`, true),
        para(`Here is your statement from ${company}, from ${dateText(from)} to ${dateText(to)}.`),
        factsBlock(facts),
        noteBlock(payload, company),
        para(ctx.canReply ? "If anything does not look right, just reply to this email and we will sort it out." : "If anything does not look right, let us know and we will sort it out."),
      ]),
      closing: para(`Thank you,\n${company}`),
      button: "View statement",
    });
  },
  // A reminder of what is overdue: the sender's own words, then the invoices.
  payment_reminder: (payload, ctx) => {
    const company = fromCompany(payload, ctx);
    const currency = payload.currency;
    const tone = str(payload.tone);
    const invoices = (Array.isArray(payload.invoices) ? payload.invoices : []) as Record<string, unknown>[];
    if (invoices.length === 0) throw new Error("A payment reminder needs its overdue invoices.");
    const total = amountText(payload.total_overdue, currency);
    const message = str(payload.message);
    const lines = invoices.map((i) => ({
      number: str(i.number),
      due: dateText(str(i.due_date)),
      late: overdueText(num(i.days_overdue)),
      amount: amountText(i.outstanding, currency),
    }));
    const today = str(payload.today);
    const list = {
      html: `<table role="presentation" style="margin:16px 0 0;border-collapse:collapse;width:100%">${lines
        .map(
          (l) =>
            `<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid #e3e9e7;font-weight:600;white-space:nowrap">${escapeHtml(l.number)}</td><td style="padding:6px 12px 6px 0;border-bottom:1px solid #e3e9e7;color:#5b6b66">Due ${escapeHtml(l.due)}, ${escapeHtml(l.late)}</td><td style="padding:6px 0;border-bottom:1px solid #e3e9e7;text-align:right;white-space:nowrap">${escapeHtml(l.amount)}</td></tr>`
        )
        .join("")}<tr><td colspan="2" style="padding:8px 12px 0 0;font-weight:700">Total overdue${today ? ` at ${escapeHtml(dateText(today))}` : ""}</td><td style="padding:8px 0 0;text-align:right;font-weight:700;white-space:nowrap">${escapeHtml(total)}</td></tr></table>`,
      text: `${lines.map((l) => `- ${l.number}: due ${l.due}, ${l.late}, ${l.amount}`).join("\n")}\nTotal overdue${today ? ` at ${dateText(today)}` : ""}: ${total}`,
    };
    const final = tone === "final";
    return documentEmail(ctx, payload, {
      subject: `${final ? "Final notice" : "Payment reminder"} from ${company}: ${total} overdue`,
      heading: final ? "Final notice" : tone === "friendly" ? "A friendly reminder" : "Payment reminder",
      preheader: `${total} overdue`,
      body: stack([message ? para(message, true) : para(`${company} is asking you to settle what is overdue.`, true), list, para("Your statement shows everything on your account and how to pay.")]),
      button: "View statement and pay",
    });
  },
  // Tickd's own message to a new trial's owner: open the link to confirm the
  // address, which lets the company email its clients (20261010250000).
  confirm_email: (payload, ctx) => {
    const url = typeof payload.url === "string" ? payload.url : null;
    if (!url) throw new Error("A confirmation email needs its link.");
    const { html, text } = layout(ctx, {
      heading: "Confirm your email address",
      preheader: "One click, and your invoices and quotes can go to clients.",
      bodyHtml: `<p style="margin:0">Thanks for starting your free trial of Tickd.</p><p style="margin:16px 0 0">Please confirm this is your email address. Until you do, ${escapeHtml(ctx.companyName)} can use everything in Tickd, but cannot email invoices, quotes, statements or job reports to clients.</p>`,
      bodyText: `Thanks for starting your free trial of Tickd.\n\nPlease confirm this is your email address. Until you do, ${ctx.companyName} can use everything in Tickd, but cannot email invoices, quotes, statements or job reports to clients.`,
      button: { label: "Confirm my email address", url },
      closing: {
        html: `<p style="margin:16px 0 0">If you did not sign up for Tickd, you can ignore this email.</p>`,
        text: "If you did not sign up for Tickd, you can ignore this email.",
      },
    });
    return { subject: "Confirm your email address for Tickd", html, text };
  },
  test: (_payload, ctx) => {
    const { html, text } = layout(ctx, {
      heading: "Your emails are working",
      preheader: "This is a test from Tickd.",
      bodyHtml: `<p style="margin:0">This is a test from ${escapeHtml(ctx.companyName)}'s Tickd account.</p><p style="margin:16px 0 0">If you can read this, emails are working. Job reports, invoices, quotes, statements and alerts will arrive like this, and replies go to your company's email address.</p>`,
      bodyText: `This is a test from ${ctx.companyName}'s Tickd account.\n\nIf you can read this, emails are working. Job reports, invoices, quotes, statements and alerts will arrive like this, and replies go to your company's email address.`,
    });
    return { subject: `Test email from ${ctx.companyName}`, html, text };
  },
};

/** The rendered email for an outbox row, or null for a template this server does not know. */
export function renderEmail(template: string, payload: Record<string, unknown>, ctx: EmailContext): RenderedEmail | null {
  const r = TEMPLATES[template];
  return r ? r(payload, ctx) : null;
}

/** Templates a company's clients receive; they carry a "stop these emails" link. */
export const CLIENT_TEMPLATES = new Set<string>(["job_report", "job_reports_day", "invoice", "quote", "statement", "payment_reminder"]);

/** Templates whose payload holds report ids the sender looks up before rendering. */
export const REPORT_TEMPLATES = new Set<string>(["job_report", "job_reports_day"]);

/** Alert emails: to the company's own people (no unsubscribe link); the sender adds the app's address. */
export const ALERT_TEMPLATES = new Set<string>(["alert", "alerts_digest"]);

/** Invoices, quotes, statements and reminders: their payload holds a link id the sender looks up before rendering, and turns into the page's address. */
export const DOCUMENT_TEMPLATES = new Set<string>(["invoice", "quote", "statement", "payment_reminder"]);
