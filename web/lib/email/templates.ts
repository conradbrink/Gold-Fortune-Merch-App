/**
 * The emails Tickd sends for a company, rendered at send time from the
 * outbox row's template and payload. One plain layout for all of them: the
 * company's name at the top (its letterhead is its own; Tickd is the
 * postman), the message, and a way to stop them at the foot.
 *
 * Plain HTML with inline styles and a text part, because email clients
 * strip most of what a web page would use.
 */

export type EmailContext = {
  companyName: string;
  /** Where "stop these emails" goes; null for mail to the company's own people. */
  unsubscribeUrl: string | null;
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
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;color:#14211e">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<p style="margin:0 0 16px;font-size:15px;font-weight:700">${company}</p>
<div style="background:#ffffff;border-radius:12px;padding:24px;line-height:1.5;font-size:15px">
<h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(parts.heading)}</h1>
${parts.bodyHtml}
${button}
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
  // A site's day, every finished job in one email.
  job_reports_day: (payload, ctx) => {
    const lines = reportLines(payload);
    const first = lines[0];
    if (!first) throw new Error("A day's report email needs its reports.");
    const jobs = lines.length === 1 ? first.jobWord.toLowerCase() : `${first.jobWord.toLowerCase()}s`;
    const items = lines
      .map((l) => `<li style="margin:0 0 8px">${escapeHtml(lineText(l))}. <a href="${escapeHtml(l.url)}" style="color:#0f5c4f">See and sign</a></li>`)
      .join("");
    const { html, text } = layout(ctx, {
      heading: `Today at ${first.siteName}`,
      bodyHtml: `<p style="margin:0 0 8px">${lines.length} ${escapeHtml(jobs)} done on ${escapeHtml(first.day)}:</p><ul style="margin:0;padding-left:20px">${items}</ul>`,
      bodyText: `${lines.length} ${jobs} done on ${first.day}:\n${lines.map((l) => `- ${lineText(l)}. See and sign: ${l.url}`).join("\n")}`,
    });
    return { subject: `${first.siteName}: ${lines.length} ${jobs} done on ${first.day}`, html, text };
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
export const CLIENT_TEMPLATES = new Set<string>(["job_report", "job_reports_day"]);

/** Templates whose payload holds report ids the sender looks up before rendering. */
export const REPORT_TEMPLATES = new Set<string>(["job_report", "job_reports_day"]);
