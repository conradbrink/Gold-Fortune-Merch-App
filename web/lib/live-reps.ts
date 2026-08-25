import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where each rep was last seen, and how long ago.
 *
 * **Not a tracker, and the UI must never imply it is one.** A position here is
 * the last fix the phone happened to send, which is a different thing from where
 * somebody is now. Today most fixes come from check-in and check-out — 270 and
 * 262 of them against 42 interval pings — because the interval sampling ran off
 * a Dart timer that Android suspends, and the fix for that is not released yet.
 * So a rep between two shops may have no fix for an hour, and the honest way to
 * present that is the age of the reading rather than a dot that looks current.
 *
 * That also means this gets better on its own once the location-stream build
 * ships, without this file changing: more `interval` rows, smaller ages.
 */

/** How stale a reading is allowed to be before it stops being "now"-ish. */
export const FRESH_MINUTES = 20;
/** Past this, the reading says where someone *was*, not where they are. */
export const STALE_MINUTES = 90;

export type PingSource =
  | "checkin"
  | "checkout"
  | "interval"
  | "workday_start"
  | "workday_end";

export type RepPosition = {
  repId: string;
  repName: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string;
  source: PingSource;
  /** Whether a workday is currently open — the difference between quiet and finished. */
  dayOpen: boolean;
  /** The store the surrounding visit was at, when the ping came from one. */
  storeName: string | null;
};

export type LiveReps = {
  positions: RepPosition[];
  /** Active reps with no position at all today. Named, not silently omitted. */
  missing: { repId: string; repName: string; dayOpen: boolean }[];
};

/** Minutes since a reading, rounded — the number the card leads with. */
export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
}

/** "just now" / "18 min ago" / "2h 5m ago". Never a bare timestamp. */
export function describeAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`;
}

/**
 * What produced the reading, in words a manager can act on.
 *
 * The source matters as much as the age: "checked out of Choppies Broadhurst"
 * places someone precisely, while an interval ping only says they were on the
 * move. Collapsing both into "last seen" would throw that away.
 */
export function describeSource(source: PingSource, store: string | null): string {
  switch (source) {
    case "checkin":
      return store ? `Arrived at ${store}` : "Checked in";
    case "checkout":
      return store ? `Left ${store}` : "Checked out";
    case "workday_start":
      return "Started the day";
    case "workday_end":
      return "Ended the day";
    case "interval":
      return "On the move";
    default:
      // A source added to the phone later would otherwise render as nothing at
      // all here — a blank line under a rep's name, with no clue why.
      return "Last known position";
  }
}

export type Freshness = "fresh" | "recent" | "stale";

export function freshnessOf(minutes: number): Freshness {
  if (minutes <= FRESH_MINUTES) return "fresh";
  if (minutes <= STALE_MINUTES) return "recent";
  return "stale";
}

/**
 * The latest reading per rep, plus the reps who have none.
 *
 * Scoped to the last 24 hours: a three-day-old position is not "where a rep is",
 * it is archaeology, and showing it on a map beside a fresh one invites reading
 * both the same way. A rep with nothing in that window appears in `missing`
 * rather than being dropped, because "no signal from Atang all day" is the most
 * useful thing this view can tell anyone.
 */
export async function fetchLiveReps(
  supabase: SupabaseClient
): Promise<LiveReps> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: repRows, error: repError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "rep")
    .eq("is_active", true)
    .order("full_name");
  if (repError) throw new Error(repError.message);
  const reps = (repRows ?? []) as { id: string; full_name: string | null }[];

  /**
   * One query per rep for their newest fix, rather than one capped query for
   * everyone.
   *
   * A global `.limit(2000)` is applied by PostgREST *before* anything is reduced
   * per rep, so on a busy day a rep whose newest ping falls beyond the cap
   * vanishes from the results and is reported as having sent nothing — the one
   * statement this card exists to make, made wrongly. There is no DISTINCT ON in
   * PostgREST, so the choice is a request each or an RPC; at the size of a field
   * team a handful of parallel requests is the smaller change and cannot be
   * silently truncated.
   */
  const [pingResults, daysRes, visitsRes] = await Promise.all([
    Promise.all(
      reps.map((rep) =>
        supabase
          .from("location_pings")
          .select("rep_id, lat, lng, accuracy_m, recorded_at, source")
          .eq("rep_id", rep.id)
          .gte("recorded_at", since)
          .order("recorded_at", { ascending: false })
          .limit(1)
      )
    ),
    supabase
      .from("workday_sessions")
      .select("rep_id")
      .is("ended_at", null)
      // An open day from last week is a rep who forgot to press End, not a rep
      // who is out now — and treating it as "working" would explain away a
      // silence that deserves explaining.
      .gte("started_at", since),
    supabase
      .from("visits")
      .select(
        "rep_id, checkin_at, checkout_at, stores!visits_store_id_fkey(name)"
      )
      .gte("checkin_at", since)
      .order("checkin_at", { ascending: false })
      .limit(500),
  ]);

  for (const res of pingResults) {
    if (res.error) throw new Error(res.error.message);
  }
  if (daysRes.error) throw new Error(daysRes.error.message);
  if (visitsRes.error) throw new Error(visitsRes.error.message);

  const openDays = new Set(
    ((daysRes.data ?? []) as { rep_id: string }[]).map((d) => d.rep_id)
  );

  type Embedded = { name: string } | { name: string }[] | null;
  const one = (e: Embedded) => (Array.isArray(e) ? e[0] ?? null : e);

  // The most recent visit per rep, for naming the shop. Rows arrive newest
  // first, so the first one seen wins.
  const lastStore = new Map<string, string>();
  for (const v of (visitsRes.data ?? []) as unknown as {
    rep_id: string;
    stores: Embedded;
  }[]) {
    if (!lastStore.has(v.rep_id)) {
      const store = one(v.stores);
      if (store) lastStore.set(v.rep_id, store.name);
    }
  }

  const latest = new Map<string, RepPosition>();
  const nameOf = new Map(reps.map((r) => [r.id, r.full_name ?? "Unnamed rep"]));

  for (const p of pingResults.flatMap((r) => r.data ?? []) as {
    rep_id: string;
    lat: number | null;
    lng: number | null;
    accuracy_m: number | null;
    recorded_at: string;
    source: PingSource;
  }[]) {
    if (latest.has(p.rep_id)) continue;
    // A ping missing either half of its position is not a position. It would
    // otherwise land at 0,0 — the Gulf of Guinea — which reads as a real place.
    if (p.lat === null || p.lng === null) continue;
    // Only reps: a manager's own phone can raise pings and does not belong on a
    // board about field coverage.
    if (!nameOf.has(p.rep_id)) continue;

    latest.set(p.rep_id, {
      repId: p.rep_id,
      repName: nameOf.get(p.rep_id)!,
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracy_m,
      recordedAt: p.recorded_at,
      source: p.source,
      dayOpen: openDays.has(p.rep_id),
      storeName: lastStore.get(p.rep_id) ?? null,
    });
  }

  const positions = [...latest.values()].sort(
    (a, b) =>
      new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
  );

  const missing = reps
    .filter((r) => !latest.has(r.id))
    .map((r) => ({
      repId: r.id,
      repName: r.full_name ?? "Unnamed rep",
      dayOpen: openDays.has(r.id),
    }));

  return { positions, missing };
}
