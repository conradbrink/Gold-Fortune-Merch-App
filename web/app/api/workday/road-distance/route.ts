import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { settleRoadDistance, type Budget } from "@/lib/road-distance-settle";

/**
 * Settles finished workdays with the distance actually driven.
 *
 * The phone accumulates a straight-line figure as it goes — free, offline, and a
 * lower bound, because five-minute sampling gives the chord rather than the road.
 * This asks Google to route through the day's pings and stores the real one
 * beside it.
 *
 * **Server-side because the key must never reach a handset.** Same reasoning as
 * `GOOGLE_GEOCODING_API_KEY` in `/api/geocode` and `OPENAI_API_KEY` in
 * `/api/insights`: no `NEXT_PUBLIC_` prefix, so Next keeps it out of the bundle.
 *
 * **Only finished days.** A day still open would be settled against a partial
 * trail and then never revisited, which is worse than not settling it — the
 * figure would look complete and be short by however far the rep drove after.
 *
 * `proxy.ts` excludes /api from its matcher, so this handler owns its own auth.
 *
 * ------------------------------------------------------------- two ways in
 *
 * POST is a signed-in manager pressing the button, charged against their own
 * hourly quota. GET is the nightly Vercel cron, which has no signed-in caller
 * to charge and carries a per-run ceiling instead.
 *
 * The nightly job exists because for the first two days of this feature there
 * was no scheduler and no button, so the only runs it ever had were manual —
 * and the column quietly stopped filling in on 25 August without anything
 * saying so. A number that appears only when somebody remembers to ask for it
 * is a number nobody can trust.
 */

export const runtime = "nodejs";
// A day is roughly ten sequential Routes calls, and a batch of days is more.
export const maxDuration = 60;

/**
 * What one unattended run may spend.
 *
 * The manual path is bounded by the caller's rate-limit bucket, which needs an
 * `auth.uid()` the cron does not have. So the cron's budget is this: a hard
 * count of Routes requests per run, checked before each day is routed. Ten
 * days at roughly ten requests each, which is a normal night's backlog and far
 * less than the hourly ceiling on the manual path.
 */
const MAX_CRON_REQUESTS = 120;

function missingConfig(): Response | null {
  if (!process.env.GOOGLE_ROUTES_API_KEY) {
    return Response.json(
      { error: "GOOGLE_ROUTES_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
      { status: 503 }
    );
  }
  return null;
}

/**
 * Settlement writes go through the service role. The caller's own client
 * cannot make them.
 *
 * `road_distance_*` are deliberately not writable by anyone through RLS — the
 * migration says so — because the Routes key is server-side and a handset
 * offering a road distance would mean the key had reached a handset. A manager
 * therefore has SELECT on `workday_sessions` and no UPDATE, which is correct
 * and was exactly the hole this route fell into: every claim silently matched
 * zero rows and every day was skipped as "someone else has it".
 */
function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    // Per-request, so nothing to persist or refresh.
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    // Asked of the database rather than compared against a role string here, so
    // this route and RLS cannot drift into disagreeing about who may do it.
    const { data: isAdmin, error: adminError } = await supabase.rpc(
      "has_permission",
      { p_code: "team" }
    );
    if (adminError) {
      return Response.json({ error: adminError.message }, { status: 502 });
    }
    if (isAdmin !== true) {
      return Response.json(
        { error: "Road distance is available to whoever manages the team." },
        { status: 403 }
      );
    }

    // After authz, so an anonymous caller learns nothing about the configuration.
    const bad = missingConfig();
    if (bad) return bad;

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
    };

    let refusal: Response | null = null;
    // Fail closed: this is about to bill Google, and an endpoint that cannot
    // count what it is spending should not spend it.
    const charge: Budget = async (cost) => {
      const gate = await enforceRateLimit(supabase, LIMITS.roadDistance, cost, {
        failClosed: true,
      });
      if (gate.ok) return null;
      refusal = gate.response;
      return "Usage limit reached before this day was routed.";
    };

    const result = await settleRoadDistance({
      admin: adminClient(),
      apiKey: process.env.GOOGLE_ROUTES_API_KEY!,
      charge,
      sessionId: body.sessionId,
    });

    // The rate limiter's own 429 or 503 is the right answer only when nothing
    // was settled. Once days have been written, the caller needs to know which,
    // so the partial result carries the reason it stopped instead.
    if (refusal && result.settled === 0 && result.days.length === 0) {
      return refusal;
    }
    return Response.json(result);
  } catch (reason) {
    const message =
      reason instanceof Error
        ? reason.message
        : "Unexpected error computing road distance.";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * The nightly run.
 *
 * Vercel Cron issues a GET carrying `Authorization: Bearer $CRON_SECRET`. The
 * comparison is length-safe and constant-ish rather than `===` on purpose:
 * this is the only credential on the endpoint, and it guards a button that
 * spends money.
 *
 * With no `CRON_SECRET` configured the route refuses rather than running
 * unauthenticated — an open endpoint that bills Google per request is the one
 * failure mode worth being loud about.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 503 }
    );
  }
  const offered = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (
    offered.length !== expected.length ||
    !timingSafeEqual(offered, expected)
  ) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  const bad = missingConfig();
  if (bad) return bad;

  try {
    let spent = 0;
    const charge: Budget = async (cost) => {
      if (spent + cost > MAX_CRON_REQUESTS) {
        return `This run reached its ceiling of ${MAX_CRON_REQUESTS} Routes requests. The days left over are settled by the next run.`;
      }
      spent += cost;
      return null;
    };

    const result = await settleRoadDistance({
      admin: adminClient(),
      apiKey: process.env.GOOGLE_ROUTES_API_KEY!,
      charge,
    });
    // Logged as well as returned: nobody reads a cron's response body, and a
    // night where every day failed should leave a trace in the platform log.
    console.info(
      `[road-distance] nightly run settled ${result.settled}, ${result.requests} requests, ${result.days.filter((d) => d.error).length} failed`
    );
    return Response.json(result);
  } catch (reason) {
    const message =
      reason instanceof Error
        ? reason.message
        : "Unexpected error computing road distance.";
    console.error(`[road-distance] nightly run failed: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Constant-time string compare, so the secret cannot be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
