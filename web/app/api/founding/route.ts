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
import { listTemplates, platformAdminClient } from "@/lib/platform";

/**
 * The Founding 10 (sales site, tickd.co.za):
 *
 *   GET   how many spots are left, for the "X of 10 spots left" line. That is
 *         one setting the owner changes by hand; it is not a count.
 *   POST  an application. Saved first (founding_applications is the record),
 *         then the owner is emailed; a mail that cannot be sent never loses
 *         the application. While no spot is left an application is still
 *         saved, as 'waitlist'.
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

  const checked = checkApplication(inputFromBody(body));
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
  let { data: saved, error } = await insert({ ...application, status });
  // The attribution column comes with its own migration. If this code is live
  // before it, PostgREST refuses the unknown column (PGRST204): save the
  // application without it rather than lose it.
  if (error?.code === "PGRST204" && application.attribution) {
    console.error("founding: attribution column missing, saved without it");
    ({ data: saved, error } = await insert({ ...application, attribution: undefined, status }));
  }
  // Likewise the email column (it comes with its own migration): save the
  // application without it, and without the confirmation, rather than lose it.
  let emailSaved = true;
  if (error?.code === "PGRST204") {
    console.error("founding: email column missing, saved without it");
    emailSaved = false;
    ({ data: saved, error } = await insert({ ...application, email: undefined, attribution: undefined, status }));
  }
  if (error || !saved) {
    console.error("founding: could not save an application", error?.message);
    return json(request, { error: "Your application could not be saved just now. Please try again." }, 500);
  }

  after(() => notifyOwner(saved.id, application, waitlist));
  const toEmail = application.email;
  if (emailSaved && toEmail) after(() => confirmToApplicant(saved.id, { ...application, email: toEmail }, waitlist));

  return json(request, { ok: true, waitlist });
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
    const label = templates.find((t) => t.code === a.trade)?.name ?? a.trade;
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
