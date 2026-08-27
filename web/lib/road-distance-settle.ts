import type { SupabaseClient } from "@supabase/supabase-js";
import {
  batchForRouting,
  computeDayRoadMetres,
  thinPings,
  type Ping,
} from "@/lib/road-distance";

/**
 * Settling finished workdays with the distance actually driven.
 *
 * Lifted out of the route handler when the nightly job arrived, because the two
 * entry points differ in exactly one thing — how they are allowed to spend
 * money — and in nothing else. A manager pressing the button is charged against
 * their own hourly quota; the cron has no signed-in caller to charge, so it
 * carries a per-run ceiling instead. Everything below that line, including the
 * claim/release protocol that stops a day being billed twice, has to be the
 * same code or the two paths will drift and only one of them will be right.
 */

/** Never settle more than this in one call, however many are outstanding. */
export const MAX_SESSIONS = 10;

/**
 * Permission to spend, asked for before each day is routed.
 *
 * Returns `null` to allow, or a reason to refuse. A refusal stops the run
 * rather than skipping one day: whatever the budget is, the next day costs at
 * least as much as this one.
 */
export type Budget = (cost: number) => Promise<string | null>;

export type SettleDay = {
  sessionId: string;
  metres?: number;
  requests?: number;
  error?: string;
};

export type SettleResult = {
  settled: number;
  requests: number;
  skipped: number;
  days: SettleDay[];
  /** Set when the run stopped early. The days already written still count. */
  stopped?: string;
};

export async function settleRoadDistance({
  admin,
  apiKey,
  charge,
  sessionId,
  orgId,
  maxSessions = MAX_SESSIONS,
}: {
  /** Service-role client. `road_distance_*` is writable by nobody through RLS. */
  admin: SupabaseClient;
  apiKey: string;
  charge: Budget;
  /** One specific day, rather than the outstanding queue. */
  sessionId?: string;
  /**
   * Confine the queue to one organisation.
   *
   * The service-role client bypasses RLS, so without this a manager pressing
   * the button settles whichever days are oldest **across every tenant** — and
   * bills their own Routes quota for somebody else's driving. The button passes
   * its caller's org; the nightly job deliberately does not, because settling
   * every organisation is the job.
   */
  orgId?: string;
  maxSessions?: number;
}): Promise<SettleResult> {
  // Finished, not yet settled, and not already known to have failed — a day
  // that could not be routed should not be retried on every run, billing the
  // same failure repeatedly. Clearing `road_distance_error` re-queues it.
  let query = admin
    .from("workday_sessions")
    .select("id, rep_id, started_at, ended_at")
    .not("ended_at", "is", null)
    .is("road_distance_at", null)
    .is("road_distance_error", null)
    .order("ended_at", { ascending: false })
    .limit(maxSessions);

  if (sessionId) query = query.eq("id", sessionId);
  if (orgId) query = query.eq("org_id", orgId);

  const { data: sessions, error: sessionsError } = await query;
  if (sessionsError) throw new Error(sessionsError.message);
  if (!sessions || sessions.length === 0) {
    // For the queue, nothing outstanding is the ordinary answer. For one named
    // day it is not: the caller asked for that session and got a success with
    // no work in it, which reads as "settled" rather than "already settled, or
    // still open, or previously failed and not retried".
    return {
      settled: 0,
      requests: 0,
      skipped: 0,
      days: [],
      ...(sessionId
        ? {
            stopped:
              "That day is not waiting to be settled — it is still open, already has a distance, or failed before. Clearing road_distance_at re-queues it.",
          }
        : {}),
    };
  }

  /**
   * Hands a claimed day back.
   *
   * Every path out of the loop that is not a successful write has to come
   * through here. A claim left standing marks the day settled with no distance
   * on it, and the eligibility filter — `road_distance_at is null` — then skips
   * it forever: neither a figure nor a reason, and no way to notice.
   */
  const release = async (id: string, why: string | null): Promise<string | null> => {
    const { error } = await admin
      .from("workday_sessions")
      .update({ road_distance_at: null, road_distance_error: why })
      .eq("id", id);
    // A release that fails leaves the claim standing, and the day is then
    // invisible to every later run — the exact state releasing exists to
    // prevent. Reported rather than swallowed, because only the original
    // error would otherwise reach the caller and it would look recoverable.
    return error ? error.message : null;
  };

  /** Combines the reason a day failed with a release that also failed. */
  const withRelease = (why: string, releaseError: string | null) =>
    releaseError
      ? `${why} — and the day could not be released for a retry (${releaseError}); clear road_distance_at to re-queue it.`
      : why;

  const days: SettleDay[] = [];
  let settled = 0;
  let requests = 0;
  let skipped = 0;
  let stopped: string | undefined;

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
    const { data: claimed, error: claimError } = await admin
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
      // Almost always a concurrent run holding it, which is not an error — the
      // other one records the outcome. But it is *reported* rather than skipped
      // in silence, because "someone else has it" and "this client cannot write
      // it at all" are indistinguishable from here, and the second looked
      // exactly like a quiet success: settled 0, days [], no error, nothing to
      // debug from.
      skipped++;
      continue;
    }

    // By session, not by rep and a time window. Every ping carries the session
    // it belongs to, and a window can pick up a neighbouring session's pings
    // where two overlap — which on this route means billing Google to route a
    // day that includes somebody else's afternoon.
    const { data: pingRows, error: pingError } = await admin
      .from("location_pings")
      .select("lat, lng, recorded_at")
      .eq("workday_session_id", session.id)
      .order("recorded_at", { ascending: true });

    if (pingError) {
      const rel = await release(session.id, pingError.message);
      days.push({
        sessionId: session.id,
        error: withRelease(pingError.message, rel),
      });
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
        const refusal = await charge(cost);
        if (refusal) {
          // Release the claim: this day was never routed and must not be left
          // looking settled. If the release itself fails the day is stranded,
          // and returning the plain refusal would hide that — the caller would
          // retry and never see this session again.
          const rel = await release(session.id, null);
          stopped = rel ? withRelease(refusal, rel) : refusal;
          break;
        }
      }

      const { metres, requests: used } = await computeDayRoadMetres(pings, apiKey);
      requests += used;

      // A day with nothing to route is settled at zero rather than left
      // pending forever — the rep opened a day and did not travel, which is a
      // real answer. `road_distance_at` is what marks it done either way.
      // `.select("id")` is what makes a lost write visible: a PostgREST update
      // matching nothing succeeds with no error and no rows, so without
      // checking the count this would report a settled day that holds no
      // distance. Same guard, and the same lesson, as `applySpread`.
      const { data: written, error: writeError } = await admin
        .from("workday_sessions")
        .update({
          road_distance_meters: metres,
          road_distance_at: new Date().toISOString(),
          road_distance_error: null,
        })
        .eq("id", session.id)
        .select("id");

      const writeFailure =
        writeError?.message ??
        ((written?.length ?? 0) === 0
          ? "The settled distance did not save — the day may have been changed while it was being routed."
          : null);

      if (writeFailure) {
        const rel = await release(session.id, writeFailure);
        days.push({
          sessionId: session.id,
          error: withRelease(writeFailure, rel),
        });
        continue;
      }

      settled++;
      days.push({ sessionId: session.id, metres, requests: used });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Could not route this day.";
      // Recorded on the row, so the next run skips it and a person can see
      // why rather than finding a permanently blank figure.
      const rel = await release(session.id, message);
      days.push({ sessionId: session.id, error: withRelease(message, rel) });
    }
  }

  return { settled, requests, skipped, days, ...(stopped ? { stopped } : {}) };
}
