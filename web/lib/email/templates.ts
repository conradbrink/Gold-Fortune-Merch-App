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

const TEMPLATES: Record<string, Renderer> = {
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
export const CLIENT_TEMPLATES = new Set<string>([]);
