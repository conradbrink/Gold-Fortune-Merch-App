import { after } from "next/server";
import { sendViaBrevo } from "@/lib/email/brevo";
import {
  applicationEmail,
  checkApplication,
  clientAddress,
  corsOrigin,
  inputFromBody,
  type FoundingApplication,
} from "@/lib/founding";
import { addToLeadsSheet, alertOwnerOnTelegram, alertOwnerOnWhatsapp } from "@/lib/lead-alerts";
import { listTemplates, platformAdminClient } from "@/lib/platform";

/**
 * The Founding 10 (sales site, tickd.co.za):
 *
 *   GET   how many spots are left, for the "X of 10 spots left" line. That is
 *         one setting the owner changes by hand; it is not a count.
 *   POST  an application. Saved first (founding_applications is the record),
 *         then the owner is emailed; a mail that cannot be sent never loses
 *         the application. While no spot is left an application is still
 *         saved, as 'waitlist'. One per person: a WhatsApp number or email
 *         address already on an application saves nothing new and sends no
 *         email; the answer says `already`. A new one also goes to the
 *         owner on Telegram or WhatsApp and into their Google Sheet
 *         (lib/lead-alerts.ts).
 *
 * Public, so it is checked again here, limited per address and per number, and
 * only the sales site's own origins are answered in a browser. `/api` is
 * outside the sign-in proxy on purpose (see proxy.ts).
 */

export const runtime = "nodejs";

// Generous: South African mobile networks put many phones behind one address,
// and the Founding ads send them here in bursts. The per-number and per-email
// limits below are what stop one person from flooding the form.
const PER_ADDRESS = { limit: 30, windowSeconds: 60 * 60 };
const PER_NUMBER = { limit: 3, windowSeconds: 24 * 60 * 60 };
/** Nobody can make us email an address they do not own, however many numbers or networks they use. */
const PER_EMAIL = { limit: 2, windowSeconds: 24 * 60 * 60 };

/**
 * Every confirmation goes out through the outbox with no company, and the outbox's daily
 * limit is per company, so this is the limit for all of them together: a flood of
 * applications with made-up addresses cannot turn Tickd into a source of unwanted mail.
 */
const CONFIRMATIONS_PER_DAY = { limit: 300, windowSeconds: 24 * 60 * 60 };

const NOTIFY_TO = process.env.FOUNDING_NOTIFY_EMAIL || "hello@tickd.co.za";
const SENDER = { email: "applications@tickd.co.za", name: "Tickd applications" };

const isProduction = () => process.env.NODE_ENV === "production";

function headersFor(request: Request, extra: Record<string, string> = {}): Record<string, string> {
  const origin = corsOrigin(request.headers.get("origin"), isProduction());
  return { ...extra, Vary: "Origin", ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) };
}

function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: headersFor(request, extra) });
}

export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: headersFor(request, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
    }),
  });
}

/** The spots left: one setting only the owner changes (platform_settings founding_spots_left). */
async function spotsLeft(): Promise<number | null> {
  const { data, error } = await platformAdminClient().rpc("founding_spots_left");
  return error || typeof data !== "number" ? null : data;
}

export async function GET(request: Request) {
  const left = await spotsLeft();
  if (left === null) return json(request, { error: "Not available just now." }, 503);
  return json(request, { left }, 200, { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !corsOrigin(origin, isProduction())) {
    return json(request, { error: "Not allowed." }, 403);
  }
  const body = (await request.json().catch(() => null)) as unknown;

  // A hidden field only a script fills in. Answer as if it worked, save nothing.
  const trap = body && typeof body === "object" ? (body as Record<string, unknown>).website : undefined;
  if (typeof trap === "string" && trap.trim()) return json(request, { ok: true, waitlist: false });

  const receivedAt = new Date();
  const checked = checkApplication(inputFromBody(body), receivedAt);
  if (!checked.ok) {
    return json(request, { error: checked.issues.map((i) => i.message).join(" "), issues: checked.issues }, 400);
  }
  const application = checked.application;

  const admin = platformAdminClient();
  const address =
    clientAddress(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")) ?? "unknown";
  for (const [bucket, subject, rule] of [
    ["founding_address", `ip:${address}`, PER_ADDRESS],
    ["founding_number", `wa:${application.whatsapp}`, PER_NUMBER],
    ...(application.email ? ([["founding_email", `email:${application.email}`, PER_EMAIL]] as const) : []),
  ] as const) {
    const { data, error } = await admin.rpc("consume_anonymous_rate_limit", {
      p_bucket: bucket,
      p_subject: subject,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) return json(request, { error: "Applying is not available just now. Please try again in a moment." }, 503);
    if ((data as { allowed?: boolean } | null)?.allowed !== true) {
      return json(request, { error: "Too many tries. Please try again later, or email us." }, 429);
    }
  }

  // One application per person (owner, 20 Oct 2026): the same WhatsApp number
  // or email address as an earlier application saves nothing new and sends no
  // email, and the form says they have already applied. Two at once from the
  // same person are stopped by the table's unique indexes (23505, below).
  const earlier = await earlierApplication(admin, application.whatsapp, application.email);
  if (earlier === undefined) {
    return json(request, { error: "Applying is not available just now. Please try again in a moment." }, 503);
  }
  if (earlier) return json(request, { ok: true, already: true, waitlist: earlier.status === "waitlist" });

  const left = await spotsLeft();
  if (left === null) return json(request, { error: "Applying is not available just now. Please try again in a moment." }, 503);
  const waitlist = left <= 0;

  const status = waitlist ? "waitlist" : "new";
  const insert = (row: Record<string, unknown>) =>
    admin
      .from("founding_applications")
      .insert(row as typeof application & { status: string })
      .select("id")
      .single();
  let row: Record<string, unknown> = { ...application, status };
  let { data: saved, error } = await insert(row);
  // Each of these columns came with its own migration. If this code is live
  // before one of them, PostgREST refuses the unknown column (PGRST204): save
  // the application without it rather than lose it. The role and the consent
  // (25 Oct 2026) first, as the newest; the alerts still carry them.
  if (error?.code === "PGRST204" && /role|contact_consent_at/.test(error.message)) {
    console.error("founding: role or consent column missing, saved without them");
    row = { ...row, role: undefined, contact_consent_at: undefined };
    ({ data: saved, error } = await insert(row));
  }
  if (error?.code === "PGRST204" && error.message.includes("distributes")) {
    console.error("founding: distributes column missing, saved without it");
    row = { ...row, distributes: undefined };
    ({ data: saved, error } = await insert(row));
  }
  if (error?.code === "PGRST204" && application.attribution) {
    console.error("founding: attribution column missing, saved without it");
    row = { ...row, attribution: undefined };
    ({ data: saved, error } = await insert(row));
  }
  // Likewise the email column: save the application without it, and without
  // the confirmation, rather than lose it.
  let emailSaved = true;
  if (error?.code === "PGRST204") {
    console.error("founding: email column missing, saved without it");
    emailSaved = false;
    row = { ...row, email: undefined, attribution: undefined };
    ({ data: saved, error } = await insert(row));
  }
  if (error?.code === "23505") return json(request, { ok: true, already: true, waitlist });
  if (error || !saved) {
    console.error("founding: could not save an application", error?.message);
    return json(request, { error: "Your application could not be saved just now. Please try again." }, 500);
  }

  after(() => notifyOwner(saved.id, application, waitlist));
  after(() => alertOwnerOnTelegram(saved.id, application, waitlist));
  after(() => alertOwnerOnWhatsapp(saved.id, application, waitlist));
  after(() => addToLeadsSheet(saved.id, application, waitlist, receivedAt));
  const toEmail = application.email;
  if (emailSaved && toEmail) after(() => confirmToApplicant(saved.id, { ...application, email: toEmail }, waitlist));

  return json(request, { ok: true, waitlist });
}

/**
 * The earliest application with this WhatsApp number or email address (both
 * are stored normalised: the number as digits, the email in lower case), null
 * when there is none, or undefined when the table could not be read. Two plain
 * lookups rather than one `or` filter, so nothing typed is ever read as filter
 * syntax.
 */
async function earlierApplication(
  admin: ReturnType<typeof platformAdminClient>,
  whatsapp: string,
  email: string | null
): Promise<{ id: string; status: string } | null | undefined> {
  const byNumber = await admin
    .from("founding_applications")
    .select("id, status")
    .eq("whatsapp", whatsapp)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (byNumber.error) return undefined;
  if (byNumber.data) return byNumber.data;
  if (!email) return null;
  const byEmail = await admin
    .from("founding_applications")
    .select("id, status")
    .eq("email", email)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (byEmail.error) return undefined;
  return byEmail.data ?? null;
}

/**
 * Tells the applicant we have their application, through the outbox (so it is
 * retried, kept in the list of what was sent, and never goes to a blocked
 * address). Never throws: the application is already saved.
 */
async function confirmToApplicant(id: string, a: FoundingApplication & { email: string }, waitlist: boolean) {
  try {
    const admin = platformAdminClient();
    const { data: room } = await admin.rpc("consume_anonymous_rate_limit", {
      p_bucket: "founding_confirmation_all",
      p_subject: "all",
      p_limit: CONFIRMATIONS_PER_DAY.limit,
      p_window_seconds: CONFIRMATIONS_PER_DAY.windowSeconds,
    });
    if ((room as { allowed?: boolean } | null)?.allowed !== true) {
      console.error("founding: the day's limit of confirmations is used, none sent for", id);
      return;
    }
    const { error } = await admin.rpc("queue_email", {
      p_org: null,
      p_to: a.email,
      p_to_name: a.name,
      p_template: "application_received",
      p_payload: { first_name: a.name.split(/\s+/)[0], business_name: a.business_name, whatsapp: a.whatsapp, waitlist },
      p_related_kind: "founding",
      p_related_id: id,
    });
    if (error) console.error("founding: the applicant's confirmation was not queued", id, error.message);
  } catch (e) {
    console.error("founding: the applicant's confirmation failed", id, e instanceof Error ? e.message : e);
  }
}

/** Emails the owner, then marks the row. Never throws: the application is already saved. */
async function notifyOwner(id: string, a: FoundingApplication, waitlist: boolean) {
  try {
    const templates = await listTemplates().catch(() => []);
    const label = a.trade ? (templates.find((t) => t.code === a.trade)?.name ?? a.trade) : null;
    const mail = applicationEmail(a, label, waitlist);
    const result = await sendViaBrevo({
      to: { email: NOTIFY_TO },
      sender: SENDER,
      replyTo: null,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (!result.ok) {
      console.error("founding: the owner's email was not sent", id, result.error);
      return;
    }
    const { error } = await platformAdminClient()
      .from("founding_applications")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error("founding: could not mark the email as sent", id, error.message);
  } catch (e) {
    console.error("founding: the owner's email failed", id, e instanceof Error ? e.message : e);
  }
}
