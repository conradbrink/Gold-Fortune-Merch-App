import { clientAddress, corsOrigin } from "@/lib/founding";
import { platformAdminClient } from "@/lib/platform";
import { checkWebEvent, deviceOf, isRobot } from "@/lib/web-events";

/**
 * Website events from the sales site (tickd.co.za): a page view or a funnel
 * event, counted by Tickd itself so the Control Centre is instant (see
 * lib/web-events.ts and migration 20261010490000_web_events).
 *
 * The site sends with navigator.sendBeacon as text/plain, a "simple" request,
 * so there is no preflight; only the sales site's own origins are answered in
 * a browser. Robots are ignored, each address is limited, and the answer is
 * always 204: counting must never break the site or tell a caller anything.
 * `/api` is outside the sign-in proxy on purpose (see proxy.ts).
 */

export const runtime = "nodejs";

const PER_ADDRESS = { limit: 600, windowSeconds: 60 * 60 };

const isProduction = () => process.env.NODE_ENV === "production";

function done(request: Request, extra: Record<string, string> = {}) {
  const origin = corsOrigin(request.headers.get("origin"), isProduction());
  return new Response(null, {
    status: 204,
    headers: { ...extra, Vary: "Origin", ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) },
  });
}

export async function OPTIONS(request: Request) {
  return done(request, {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !corsOrigin(origin, isProduction())) return done(request);
  const userAgent = request.headers.get("user-agent");
  if (isRobot(userAgent)) return done(request);

  const raw = await request.text().catch(() => "");
  if (raw.length > 4000) return done(request);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return done(request);
  }
  const row = checkWebEvent(body, deviceOf(userAgent), request.headers.get("x-vercel-ip-country"));
  if (!row) return done(request);

  const admin = platformAdminClient();
  const address = clientAddress(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")) ?? "unknown";
  const { data: limited } = await admin.rpc("consume_anonymous_rate_limit", {
    p_bucket: "web_events",
    p_subject: `ip:${address}`,
    p_limit: PER_ADDRESS.limit,
    p_window_seconds: PER_ADDRESS.windowSeconds,
  });
  if ((limited as { allowed?: boolean } | null)?.allowed !== true) return done(request);

  const { error } = await admin.from("web_events").insert(row);
  if (error) console.error("events: could not save a website event", error.code, error.message);
  return done(request);
}
