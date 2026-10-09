import { timingSafeEqual } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { brevoConfigured, sendViaBrevo } from "@/lib/email/brevo";
import { CLIENT_TEMPLATES, renderEmail } from "@/lib/email/templates";
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

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  for (const m of rows ?? []) {
    if (Date.now() - started > 40_000) {
      // Out of time: back in the queue untouched, for the next run.
      await admin.from("message_outbox").update({ status: "queued", attempts: Math.max(0, m.attempts - 1) }).eq("id", m.id);
      deferred++;
      continue;
    }
    const org = await orgOf(m.org_id);
    const companyName = org?.name?.trim() || "Tickd";
    const unsubscribeUrl = CLIENT_TEMPLATES.has(m.template) ? `${appUrl()}/c/unsubscribe/${signLink("unsubscribe", m.id)}` : null;
    const email = renderEmail(m.template, (m.payload ?? {}) as Record<string, unknown>, { companyName, unsubscribeUrl });
    if (!email) {
      await finish({ p_id: m.id, p_ok: false, p_error: `Unknown template ${m.template}`, p_permanent: true });
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
