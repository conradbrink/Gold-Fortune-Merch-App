import { timingSafeEqual } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { brevoConfigured, sendViaBrevo } from "@/lib/email/brevo";
import { CLIENT_TEMPLATES, REPORT_TEMPLATES, renderEmail, type ReportLine } from "@/lib/email/templates";
import { companyTime } from "@/lib/company-time";
import { appUrl, signLink } from "@/lib/email/links";

/**
 * Sends what is due in the outbox (Stage 8.1).
 *
 * The database decides what to send and when (`queue_email`, and the jobs
 * that queue reports and alerts); this only delivers. It claims up to 50 due
 * rows at a time (`claim_messages`, one sender per row), renders each from its
 * template, sends it through Brevo and records the result
 * (`finish_message`): sent, tried again later, or failed for good.
 *
 * Every email goes from the company's name at Tickd's address, with replies
 * to the company's own email; mail to a company's clients carries a signed
 * "stop these emails" link.
 *
 * With no BREVO_API_KEY on the server nothing is claimed: rows wait, queued,
 * until the key exists. Vercel Cron calls it every five minutes with
 * `Authorization: Bearer $CRON_SECRET`.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const SENDER_EMAIL = "reports@tickd.co.za";

function matches(given: string, want: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Org = { name: string; support_email: string | null };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured on the server." }, { status: 503 });
  if (!matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Supabase is not configured on the server." }, { status: 503 });
  }
  if (!brevoConfigured()) {
    return Response.json({ error: "BREVO_API_KEY is not configured; nothing was sent." }, { status: 503 });
  }

  const admin = createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // A row left "sending" by a run that died mid-send may or may not have been
  // delivered. Sending it again could send it twice, so after half an hour it
  // is marked failed with that said, and the company sees it in Settings.
  const { error: staleError } = await admin
    .from("message_outbox")
    .update({ status: "failed", last_error: "Interrupted while sending; it may have been delivered." })
    .eq("status", "sending")
    .lt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());
  if (staleError) console.error("messages: could not settle interrupted sends", staleError.message);

  // 20 at a time, and none started after 40 seconds: each send may wait 15
  // seconds and the function has 60. What is left waits for the next run.
  const started = Date.now();
  const { data: rows, error } = await admin.rpc("claim_messages", { p_limit: 20 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const orgs = new Map<string, Org | null>();
  async function orgOf(id: string | null): Promise<Org | null> {
    if (!id) return null;
    if (!orgs.has(id)) {
      const { data } = await admin.from("organizations").select("name, support_email").eq("id", id).maybeSingle();
      orgs.set(id, (data as Org | null) ?? null);
    }
    return orgs.get(id) ?? null;
  }

  async function finish(args: { p_id: string; p_ok: boolean; p_provider_id?: string | null; p_error?: string | null; p_permanent?: boolean }) {
    const { error: e } = await admin.rpc("finish_message", args);
    // Left "sending", the row is settled by the step above on a later run.
    if (e) console.error("messages: could not record the result of", args.p_id, e.message);
  }

  // Each report as one line of the email: looked up when it is sent, so the
  // email says what the report says now, with its own signed link.
  async function reportLines(ids: unknown): Promise<ReportLine[]> {
    const lines: ReportLine[] = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== "string") continue;
      const { data, error: lookupError } = await admin.rpc("job_report_view", { p_report_id: id });
      // A lookup that failed is not a report that expired: the caller retries it.
      if (lookupError) throw new Error(lookupError.message);
      const v = data as {
        timezone: string;
        job_word: string;
        site: { name: string } | null;
        staff_name: string | null;
        day: string;
        checkin_at: string;
        checkout_at: string | null;
        on_site: boolean | null;
        photos: unknown[];
      } | null;
      if (!v) continue;
      lines.push({
        url: `${appUrl()}/c/report/${signLink("report", id)}`,
        siteName: v.site?.name ?? "",
        staffName: v.staff_name,
        day: v.day,
        timeIn: companyTime(v.checkin_at, v.timezone),
        timeOut: companyTime(v.checkout_at, v.timezone),
        photos: v.photos.length,
        onSite: v.on_site,
        jobWord: v.job_word,
      });
    }
    return lines;
  }

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  for (const m of rows ?? []) {
    if (Date.now() - started > 40_000) {
      // Out of time: back in the queue untouched, for the next run.
      const { error: back } = await admin
        .from("message_outbox")
        .update({ status: "queued", attempts: Math.max(0, m.attempts - 1) })
        .eq("id", m.id)
        .eq("status", "sending");
      if (back) console.error("messages: could not put back", m.id, back.message);
      else deferred++;
      continue;
    }
    const org = await orgOf(m.org_id);
    const companyName = org?.name?.trim() || "Tickd";
    const unsubscribeUrl = CLIENT_TEMPLATES.has(m.template) ? `${appUrl()}/c/unsubscribe/${signLink("unsubscribe", m.id)}` : null;
    let payload = (m.payload ?? {}) as Record<string, unknown>;
    if (REPORT_TEMPLATES.has(m.template)) {
      try {
        payload = { ...payload, reports: await reportLines(payload.report_ids) };
      } catch (e) {
        // Back in the queue, not failed: the next run tries again.
        await finish({ p_id: m.id, p_ok: false, p_error: `The report could not be looked up: ${e instanceof Error ? e.message : String(e)}` });
        failed++;
        continue;
      }
    }
    let email: ReturnType<typeof renderEmail> = null;
    let renderError: string | null = null;
    try {
      email = renderEmail(m.template, payload, { companyName, unsubscribeUrl });
    } catch (e) {
      renderError = e instanceof Error ? e.message : String(e);
    }
    if (!email) {
      await finish({
        p_id: m.id,
        p_ok: false,
        // Every lookup worked and found nothing: the reports expired or were
        // withdrawn before sending. Anything else is the template's own fault.
        p_error:
          REPORT_TEMPLATES.has(m.template) && renderError
            ? "The report expired or was withdrawn"
            : renderError ?? `Unknown template ${m.template}`,
        p_permanent: true,
      });
      failed++;
      continue;
    }
    const result = await sendViaBrevo({
      to: { email: m.to_address, name: m.to_name },
      sender: { email: SENDER_EMAIL, name: companyName.slice(0, 60) },
      replyTo: org?.support_email ? { email: org.support_email, name: companyName } : null,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: unsubscribeUrl ? { "List-Unsubscribe": `<${unsubscribeUrl}>` } : undefined,
    });
    if (result.ok) {
      await finish({ p_id: m.id, p_ok: true, p_provider_id: result.messageId });
      sent++;
    } else {
      await finish({ p_id: m.id, p_ok: false, p_error: result.error, p_permanent: result.permanent });
      failed++;
    }
  }
  return Response.json({ claimed: rows?.length ?? 0, sent, failed, deferred });
}
