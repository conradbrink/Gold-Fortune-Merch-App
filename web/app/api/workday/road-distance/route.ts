import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  batchForRouting,
  computeDayRoadMetres,
  thinPings,
  type Ping,
} from "@/lib/road-distance";

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
 */

export const runtime = "nodejs";
// A day is roughly ten sequential Routes calls, and a batch of days is more.
export const maxDuration = 60;

/** Never settle more than this in one call, however many are outstanding. */
const MAX_SESSIONS = 10;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "manager") {
      return Response.json(
        { error: "Road distance is available to managers only." },
        { status: 403 }
      );
    }

    // After authz, so an anonymous caller learns nothing about the configuration.
    const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "GOOGLE_ROUTES_API_KEY is not configured on the server." },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
    };

    // Finished, not yet settled, and not already known to have failed — a day
    // that could not be routed should not be retried on every run, billing the
    // same failure repeatedly. Clearing `road_distance_error` re-queues it.
    let query = supabase
      .from("workday_sessions")
      .select("id, rep_id, started_at, ended_at")
      .not("ended_at", "is", null)
      .is("road_distance_at", null)
      .is("road_distance_error", null)
      .order("ended_at", { ascending: false })
      .limit(MAX_SESSIONS);

    if (body.sessionId) query = query.eq("id", body.sessionId);

    const { data: sessions, error: sessionsError } = await query;
    if (sessionsError) {
      return Response.json({ error: sessionsError.message }, { status: 500 });
    }
    if (!sessions || sessions.length === 0) {
      return Response.json({ settled: 0, requests: 0, days: [] });
    }

    const days: {
      sessionId: string;
      metres?: number;
      requests?: number;
      error?: string;
    }[] = [];
    let settled = 0;
    let requests = 0;

    for (const session of sessions as {
      id: string;
      rep_id: string;
      started_at: string;
      ended_at: string;
    }[]) {
      /**
       * Claim the day before spending anything on it.
       *
       * Two runs overlapping — a retry, a second tab, a cron beside a manual
       * press — both select the same rows while `road_distance_at` is still
       * null, and both pay Google to compute the same day. The claim is a
       * conditional update: `is("road_distance_at", null)` makes it a
       * compare-and-set, and PostgREST returning no rows means somebody else
       * got there first.
       *
       * `road_distance_at` is stamped now and the metres filled in afterwards,
       * so a crash mid-route leaves a claimed day with no distance. That is the
       * deliberate trade — a day that has to be re-queued by hand is better than
       * one billed twice — and clearing the timestamp re-queues it.
       */
      const { data: claimed, error: claimError } = await supabase
        .from("workday_sessions")
        .update({ road_distance_at: new Date().toISOString() })
        .eq("id", session.id)
        .is("road_distance_at", null)
        .select("id");

      if (claimError) {
        days.push({ sessionId: session.id, error: claimError.message });
        continue;
      }
      if (!claimed || claimed.length === 0) {
        // Someone else is settling it. Not an error, and not worth reporting as
        // one — the other run will record the outcome.
        continue;
      }

      // By session, not by rep and a time window. Every ping carries the session
      // it belongs to (647 of 648 in production do), and a window can pick up a
      // neighbouring session's pings where two overlap — which on this route
      // means billing Google to route a day that includes somebody else's
      // afternoon.
      const { data: pingRows, error: pingError } = await supabase
        .from("location_pings")
        .select("lat, lng, recorded_at")
        .eq("workday_session_id", session.id)
        .order("recorded_at", { ascending: true });

      if (pingError) {
        days.push({ sessionId: session.id, error: pingError.message });
        continue;
      }

      const pings: Ping[] = ((pingRows ?? []) as {
        lat: number | null;
        lng: number | null;
        recorded_at: string;
      }[])
        // A ping missing either half is not a position; routing through 0,0
        // would send the day via the Gulf of Guinea.
        .filter((p) => p.lat !== null && p.lng !== null)
        .map((p) => ({
          lat: p.lat as number,
          lng: p.lng as number,
          recordedAt: p.recorded_at,
        }));

      try {
        // Quota charged on the work actually about to happen, not a flat guess.
        // Ten per session was wrong in both directions: a quiet day bills one
        // request and was charged ten, and a long one produces eleven or more
        // and was still charged ten — so a run could outspend its own ceiling.
        const cost = batchForRouting(thinPings(pings)).length;
        if (cost > 0) {
          const gate = await enforceRateLimit(
            supabase,
            LIMITS.roadDistance,
            cost
          );
          if (!gate.ok) {
            // Release the claim: this day was never routed and must not be left
            // looking settled.
            await supabase
              .from("workday_sessions")
              .update({ road_distance_at: null })
              .eq("id", session.id);
            return gate.response;
          }
        }

        const { metres, requests: used } = await computeDayRoadMetres(
          pings,
          apiKey
        );
        requests += used;

        // A day with nothing to route is settled at zero rather than left
        // pending forever — the rep opened a day and did not travel, which is a
        // real answer. `road_distance_at` is what marks it done either way.
        const { error: writeError } = await supabase
          .from("workday_sessions")
          .update({
            road_distance_meters: metres,
            road_distance_at: new Date().toISOString(),
            road_distance_error: null,
          })
          .eq("id", session.id)
          .select("id");

        if (writeError) {
          days.push({ sessionId: session.id, error: writeError.message });
          continue;
        }

        settled++;
        days.push({ sessionId: session.id, metres, requests: used });
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : "Could not route this day.";
        // Recorded on the row, so the next run skips it and a person can see
        // why rather than finding a permanently blank figure.
        // Clear the claim and record why. Leaving `road_distance_at` set would
        // mark the day settled with no distance on it, and the next run would
        // skip it forever.
        await supabase
          .from("workday_sessions")
          .update({ road_distance_at: null, road_distance_error: message })
          .eq("id", session.id);
        days.push({ sessionId: session.id, error: message });
      }
    }

    return Response.json({ settled, requests, days });
  } catch (reason) {
    const message =
      reason instanceof Error
        ? reason.message
        : "Unexpected error computing road distance.";
    return Response.json({ error: message }, { status: 500 });
  }
}
