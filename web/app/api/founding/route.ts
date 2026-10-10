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
 *   GET   how many spots are left, for the "X of 10 spots left" line.
 *   POST  an application. Saved first (founding_applications is the record),
 *         then the owner is emailed; a mail that cannot be sent never loses
 *         the application. After every spot is taken an application is still
 *         saved, as 'waitlist'.
 *
 * Public, so it is checked again here, limited per address and per number, and
 * only the sales site's own origins are answered in a browser. `/api` is
 * outside the sign-in proxy on purpose (see proxy.ts).
 */

export const runtime = "nodejs";

const PER_ADDRESS = { limit: 6, windowSeconds: 60 * 60 };
const PER_NUMBER = { limit: 3, windowSeconds: 24 * 60 * 60 };

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

type Spots = { total: number; taken: number; left: number };

async function spots(): Promise<Spots | null> {
  const { data, error } = await platformAdminClient().rpc("founding_spots");
  const s = data as Partial<Spots> | null;
  if (error || !s || typeof s.left !== "number" || typeof s.total !== "number" || typeof s.taken !== "number") return null;
  return { total: s.total, taken: s.taken, left: s.left };
}

export async function GET(request: Request) {
  const s = await spots();
  if (!s) return json(request, { error: "Not available just now." }, 503);
  return json(request, s, 200, { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" });
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

  const before = await spots();
  if (!before) return json(request, { error: "Applying is not available just now. Please try again in a moment." }, 503);
  const waitlist = before.left <= 0;

  const { data: saved, error } = await admin
    .from("founding_applications")
    .insert({ ...application, status: waitlist ? "waitlist" : "new" })
    .select("id")
    .single();
  if (error || !saved) {
    console.error("founding: could not save an application", error?.message);
    return json(request, { error: "Your application could not be saved just now. Please try again." }, 500);
  }

  after(() => notifyOwner(saved.id, application, waitlist));

  return json(request, { ok: true, waitlist });
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
