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
import { ageingParts, amountText, dayText as dateText, overdueText, periodText } from "@/lib/client-document";

export type EmailContext = {
  companyName: string;
  /** Where "stop these emails" goes; null for mail to the company's own people. */
  unsubscribeUrl: string | null;
  /** The document's PDF is attached to this email. */
  attached?: boolean;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The shared frame: heading, body paragraphs (already HTML), optional button, footer. */
export function layout(
  ctx: EmailContext,
  parts: { heading: string; bodyHtml: string; bodyText: string; button?: { label: string; url: string } }
): { html: string; text: string } {
  const company = escapeHtml(ctx.companyName);
  const button = parts.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(parts.button.url)}" style="background:#0f5c4f;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(parts.button.label)}</a></p>`
    : "";
  const stop = ctx.unsubscribeUrl
    ? ` <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#5b6b66">Stop these emails</a>.`
    : "";
  const attachedHtml = ctx.attached
    ? `<p style="margin:0;font-size:13px;color:#5b6b66">The PDF is attached to this email.</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;color:#14211e">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 16px;font-size:15px;font-weight:700">${company}</p>
<div style="background:#ffffff;border-radius:12px;padding:24px;line-height:1.5;font-size:15px">
<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(parts.heading)}</h1>
${parts.bodyHtml}
${button}${attachedHtml}
</div>
<p style="margin:16px 0 0;font-size:12px;color:#5b6b66;line-height:1.5">Sent for ${company} by Tickd.${stop}</p>
</div></body></html>`;
  const text = [
    ctx.companyName,
    "",
    parts.heading,
    "",
    parts.bodyText,
    parts.button ? `\n${parts.button.label}: ${parts.button.url}` : "",
    ctx.attached ? "\nThe PDF is attached to this email." : "",
    "",
    `Sent for ${ctx.companyName} by Tickd.${ctx.unsubscribeUrl ? ` Stop these emails: ${ctx.unsubscribeUrl}` : ""}`,
  ].join("\n");
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

/** The sender's optional note, as a quoted line; nothing when there is none. */
function noteBlock(payload: Record<string, unknown>): { html: string; text: string } {
  const note = str(payload.note);
  if (!note) return { html: "", text: "" };
  return {
    html: `<p style="margin:16px 0 0;padding:12px 14px;background:#f4f7f6;border-radius:8px;font-style:italic;color:#2f3f3b">&ldquo;${htmlLines(note)}&rdquo;</p>`,
    text: note
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join("\n"),
  };
}

type Fact = { label: string; value: string; strong?: boolean };

/** The few figures an email is about, as a small table. */
function factsBlock(facts: Fact[]): { html: string; text: string } {
  const rows = facts
    .map(
      (f) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#5b6b66;vertical-align:top">${escapeHtml(f.label)}</td><td style="padding:4px 0;${f.strong ? "font-weight:700;font-size:17px" : "font-weight:600"}">${escapeHtml(f.value)}</td></tr>`
    )
    .join("");
  return {
    html: `<table role="presentation" style="margin:16px 0 0;border-collapse:collapse">${rows}</table>`,
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
  email: { subject: string; heading: string; body: { html: string; text: string }; button: string }
): RenderedEmail {
  const url = str(payload.url);
  if (!url) throw new Error("A document email needs the link to its page.");
  const { html, text } = layout(ctx, {
    heading: email.heading,
    bodyHtml: email.body.html,
    bodyText: email.body.text,
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
    const { html, text } = layout(ctx, {
      heading: `${l.jobWord} done at ${l.siteName}`,
      bodyHtml: `<p style="margin:0 0 8px">${escapeHtml(l.day)}: ${escapeHtml(lineText(l))}.</p><p style="margin:0">See the checklist and photos, and sign it off if you are happy with the ${escapeHtml(job)}.</p>`,
      bodyText: `${l.day}: ${lineText(l)}.\nSee the checklist and photos, and sign it off if you are happy with the ${job}.`,
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
      .map((l) => `<li style="margin:0 0 8px">${escapeHtml(text(l))}. <a href="${escapeHtml(l.url)}" style="color:#0f5c4f">See and sign</a></li>`)
      .join("");
    const { html, text: bodyText } = layout(ctx, {
      heading: oneDay ? `${first.siteName}, ${first.day}` : first.siteName,
      bodyHtml: `<p style="margin:0 0 8px">${lines.length} ${escapeHtml(jobs)} done ${escapeHtml(when)}:</p><ul style="margin:0;padding-left:20px">${items}</ul>`,
      bodyText: `${lines.length} ${jobs} done ${when}:\n${lines.map((l) => `- ${text(l)}. See and sign: ${l.url}`).join("\n")}`,
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
    const currency = payload.currency;
    const who = str(payload.customer_name);
    const facts: Fact[] = [
      { label: "Amount", value: amountText(payload.total, currency), strong: true },
      ...(str(payload.issue_date) ? [{ label: "Invoice date", value: dateText(str(payload.issue_date)) }] : []),
      ...(str(payload.due_date) ? [{ label: "Payment due", value: dateText(str(payload.due_date)) }] : []),
      ...(str(payload.reference) ? [{ label: "Reference", value: str(payload.reference) }] : []),
    ];
    return documentEmail(ctx, payload, {
      subject: `Invoice ${number} from ${company}`,
      heading: `Invoice ${number}`,
      body: stack([
        para(`${company} has sent you invoice ${number}${who ? `, made out to ${who}` : ""}.`, true),
        factsBlock(facts),
        noteBlock(payload),
        para("Open it to see the full invoice, what has been paid so far, how to pay, and to download a PDF."),
      ]),
      button: "View invoice",
    });
  },
  // A quote, with a link to its page.
  quote: (payload, ctx) => {
    const number = str(payload.number);
    if (!number) throw new Error("A quote email needs the quote number.");
    const company = fromCompany(payload, ctx);
    const who = str(payload.customer_name);
    const facts: Fact[] = [
      { label: "Total", value: amountText(payload.total, payload.currency), strong: true },
      ...(str(payload.valid_until) ? [{ label: "Valid until", value: dateText(str(payload.valid_until)) }] : []),
    ];
    return documentEmail(ctx, payload, {
      subject: `Quote ${number} from ${company}`,
      heading: `Quote ${number}`,
      body: stack([
        para(`${company} has sent you quote ${number}${who ? ` for ${who}` : ""}.`, true),
        factsBlock(facts),
        noteBlock(payload),
        para("Open it to see every line and the total, and to download a PDF."),
      ]),
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
    const ageing = ageingParts(payload.ageing as Record<string, number> | undefined);
    const facts: Fact[] = [
      { label: `Balance at ${dateText(to)}`, value: amountText(payload.balance, payload.currency), strong: true },
      ...ageing.map((a) => ({ label: a.label, value: amountText(a.amount, payload.currency) })),
    ];
    return documentEmail(ctx, payload, {
      subject: `Statement from ${company}, ${periodText(from, to)}`,
      heading: "Your statement",
      body: stack([
        para(`${company} has sent you a statement${who ? ` for ${who}` : ""}, from ${dateText(from)} to ${dateText(to)}.`, true),
        factsBlock(facts),
        noteBlock(payload),
        para("Open it to see every invoice, credit note and payment in the period, and to download a PDF."),
      ]),
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
            `<tr><td style="padding:6px 12px 6px 0;border-bottom:1px solid #e3e9e7;font-weight:600">${escapeHtml(l.number)}</td><td style="padding:6px 12px 6px 0;border-bottom:1px solid #e3e9e7;color:#5b6b66">Due ${escapeHtml(l.due)}, ${escapeHtml(l.late)}</td><td style="padding:6px 0;border-bottom:1px solid #e3e9e7;text-align:right;white-space:nowrap">${escapeHtml(l.amount)}</td></tr>`
        )
        .join("")}<tr><td colspan="2" style="padding:8px 12px 0 0;font-weight:700">Total overdue${today ? ` at ${escapeHtml(dateText(today))}` : ""}</td><td style="padding:8px 0 0;text-align:right;font-weight:700;white-space:nowrap">${escapeHtml(total)}</td></tr></table>`,
      text: `${lines.map((l) => `- ${l.number}: due ${l.due}, ${l.late}, ${l.amount}`).join("\n")}\nTotal overdue${today ? ` at ${dateText(today)}` : ""}: ${total}`,
    };
    const final = tone === "final";
    return documentEmail(ctx, payload, {
      subject: `${final ? "Final notice" : "Payment reminder"} from ${company}: ${total} overdue`,
      heading: final ? "Final notice" : tone === "friendly" ? "A friendly reminder" : "Payment reminder",
      body: stack([message ? para(message, true) : para(`${company} is asking you to settle what is overdue.`, true), list, para("Open your statement to see everything on your account, how to pay, and to download a PDF.")]),
      button: "View statement and pay",
    });
  },
  test: (_payload, ctx) => {
    const { html, text } = layout(ctx, {
      heading: "Your emails are working",
      bodyHtml: `<p style="margin:0">This is a test from ${escapeHtml(ctx.companyName)}'s Tickd account. Reports and alerts will arrive like this, and replies go to your company's email address.</p>`,
      bodyText: `This is a test from ${ctx.companyName}'s Tickd account. Reports and alerts will arrive like this, and replies go to your company's email address.`,
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
