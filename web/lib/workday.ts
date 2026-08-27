import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/types";

/**
 * Starting and stopping your own working day, from the web.
 *
 * The same `workday_sessions` table the Android app writes, deliberately — the
 * brief's first rule for attendance was not to build a second clock-in, and
 * this is the same clock reached from a different screen. HR attendance,
 * the working-day card and the road-distance settlement all read these rows
 * and none of them needs to know which button produced one.
 *
 * ⚠️ Two honest differences from the phone, both of which show up downstream:
 *
 *   * **No trail.** The phone samples a position every five minutes; a browser
 *     gives one fix when the button is pressed. So a web-recorded day has no
 *     `location_pings` behind it and its road distance stays null rather than
 *     wrong — the Routes API has nothing to snap.
 *   * **Coarser positions.** A laptop on wifi can be a kilometre out. The hours
 *     are exact; treat the coordinates as "roughly where they were".
 *
 * A refused or failed location is NOT a refused check-in. Somebody who has
 * denied the browser location permission still needs their hours recorded, and
 * a start with no coordinates is a start.
 */

export type WorkdaySession = Tables<"workday_sessions">;

export type WorkdayState = {
  /** The open session, if the day has been started and not stopped. */
  open: WorkdaySession | null;
};

export async function fetchOpenWorkday(
  supabase: SupabaseClient
): Promise<WorkdayState> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { open: null };

  const { data, error } = await supabase
    .from("workday_sessions")
    .select("*")
    .eq("rep_id", auth.user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return { open: ((data ?? [])[0] as WorkdaySession) ?? null };
}

type Fix = { lat: number | null; lng: number | null };

/**
 * One position, or nulls.
 *
 * Times out rather than hanging: a browser that has been told "ask every time"
 * and is then ignored leaves the promise open for ever, and a Start button that
 * spins until the tab is closed is worse than one that records the hours
 * without a position.
 */
export function currentPosition(timeoutMs = 8000): Promise<Fix> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ lat: null, lng: null });
      return;
    }
    let settled = false;
    const done = (fix: Fix) => {
      if (settled) return;
      settled = true;
      resolve(fix);
    };
    const timer = setTimeout(() => done({ lat: null, lng: null }), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        done({ lat: null, lng: null });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

export async function startWorkday(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<void> {
  const fix = await currentPosition();
  const { data, error } = await supabase
    .from("workday_sessions")
    .insert({
      org_id: orgId,
      rep_id: userId,
      // The phone generates one of these so a queued offline session is not
      // inserted twice when the signal returns. The web is online by
      // definition, but the column is required and the same shape keeps the two
      // sources indistinguishable to everything downstream.
      client_generated_id: crypto.randomUUID(),
      started_at: new Date().toISOString(),
      start_lat: fix.lat,
      start_lng: fix.lng,
    })
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("The day was not started — you may not have permission.");
  }
}

export async function stopWorkday(
  supabase: SupabaseClient,
  session: WorkdaySession,
  userId: string
): Promise<void> {
  const fix = await currentPosition();
  const endedAt = new Date();
  const started = new Date(session.started_at);
  const { data, error } = await supabase
    .from("workday_sessions")
    .update({
      ended_at: endedAt.toISOString(),
      end_lat: fix.lat,
      end_lng: fix.lng,
      // Computed here rather than left to the reader, because the attendance
      // report sums this column and a null would silently drop the day's hours
      // out of every total.
      duration_seconds: Math.max(
        0,
        Math.round((endedAt.getTime() - started.getTime()) / 1000)
      ),
      ended_by: userId,
    })
    .eq("id", session.id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("The day was not stopped — you may not have permission.");
  }
}

/** `3h 04m`, counted from the start of an open session. */
export function elapsedSince(iso: string, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
