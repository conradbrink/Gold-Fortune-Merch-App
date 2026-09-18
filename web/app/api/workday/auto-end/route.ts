import { timingSafeEqual } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Ends every workday still open past 19:30.
 *
 * A rep who forgets to end their day leaves the phone sampling GPS all night
 * and the day out of every total: the attendance report has a shift with no
 * end, and the nightly road-distance job — which settles only finished days —
 * never gets to it. It happened in September 2026. The rule lives in the
 * database (`auto_end_overdue_workdays`)
 * so that the phone, which ends its own day at the same moment, and this job,
 * which catches a phone that was dead, write the same answer: the cut-off on
 * the day the session started, in the organisation's timezone.
 *
 * `proxy.ts` excludes /api from its matcher, so this handler owns its own auth.
 * GET only — there is no button for this and no per-user quota to charge; a
 * manager who wants one day closed by hand has the Working day card.
 *
 * ⚠️ Vercel crons run in **UTC only**, and `web/vercel.json` says
 * `30 17 * * *`: 19:30 in Botswana (CAT, UTC+2, no daylight saving). The
 * database does the timezone arithmetic, so a late run — the Hobby plan fires
 * "within the hour" — still closes the day as of 19:30, not as of when it got
 * round to it. What the schedule has to get right is only that it falls after
 * the cut-off for every organisation this serves.
 */

export const runtime = "nodejs";

function adminClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    // Per-request, so nothing to persist or refresh.
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Vercel Cron issues a GET carrying `Authorization: Bearer $CRON_SECRET`. With
 * no `CRON_SECRET` configured the route refuses rather than running
 * unauthenticated: this closes other people's days.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 503 }
    );
  }
  if (!matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 }
    );
  }

  const { data, error } = await adminClient().rpc("auto_end_overdue_workdays");
  if (error) {
    console.error(`[auto-end] nightly run failed: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const closed = data ?? [];
  // Logged as well as returned: nobody reads a cron's response body, and a
  // night that closed somebody's day should leave a trace in the platform log.
  console.info(
    `[auto-end] closed ${closed.length} workday${closed.length === 1 ? "" : "s"}` +
      (closed.length
        ? ": " + closed.map((d) => `${d.session_id} (rep ${d.rep_id}, started ${d.started_at})`).join(", ")
        : "")
  );
  return Response.json({ closed: closed.length, sessions: closed });
}

/** Constant-time compare — see /api/workday/road-distance for why. */
function matches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
