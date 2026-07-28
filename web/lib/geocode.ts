import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client side of geocoding. The Google key lives only on the server, so
 * everything here talks to our own `/api/geocode`.
 *
 * The handler proposes and this applies — deliberately two steps. A coordinate
 * in the wrong place is worse than no coordinate, because the geofence follows
 * it: a rep standing in the right shop would be recorded as off-site. So a
 * result whose town disagrees with the town we already derived is never
 * written without someone looking at it.
 */

export type GeocodeCandidate = {
  storeId: string;
  lat: number | null;
  lng: number | null;
  source: "places" | "geocoding" | null;
  matched: string | null;
  matchesTown: boolean;
  expectedTown: string | null;
  problem: string | null;
};

/** Safe to apply without review: found, in-country, and in the expected town. */
export function isConfident(c: GeocodeCandidate): boolean {
  return c.problem === null && c.matchesTown && c.lat !== null && c.lng !== null;
}

/**
 * How much a store's coordinates can be trusted, in one word.
 *
 * Four of these are `geocode_source` values; the other three describe stores
 * that have no coordinates at all, and keeping them distinct is the point —
 * "a lookup found the wrong shop and we removed it" and "nobody has ever
 * looked" call for different actions from a manager.
 */
export type GeocodeState =
  | "rep"
  | "manual"
  | "places"
  | "geocoding"
  | "unsourced"
  | "rejected"
  | "missing";

/** Optional so both a full `stores` row and a partial projection satisfy it. */
export type GeocodeFacts = {
  lat?: number | null;
  lng?: number | null;
  geocode_source?: string | null;
  geocoded_at?: string | null;
  geocode_result?: string | null;
};

/**
 * Classifies a store by what is known about its location.
 *
 * **Coordinates are tested before source, and that order is load-bearing.**
 * `clearCoordinates` below nulls `lat`, `lng` and `geocode_source` but
 * deliberately keeps `geocoded_at`, `geocode_result`, `geocode_accuracy_m` and
 * `geocode_visit_id`. So anything that branches on `geocoded_at !== null` — the
 * obvious way to write this — will confidently date-stamp a store that has no
 * location, and anything reading `geocode_accuracy_m` will print a tolerance
 * for a coordinate that no longer exists.
 *
 * The leftover fields are evidence, not state. They say what was tried; only
 * `lat`/`lng` say what is true now.
 */
export function geocodeState(s: GeocodeFacts): GeocodeState {
  if (s.lat === null || s.lat === undefined || s.lng === null || s.lng === undefined) {
    // Something answered once and was rejected — the wrong answer is kept so
    // nobody runs the same lookup and accepts it a second time.
    return s.geocoded_at || s.geocode_result ? "rejected" : "missing";
  }
  switch (s.geocode_source) {
    case "rep":
    case "manual":
    case "places":
    case "geocoding":
      return s.geocode_source;
    default:
      // Coordinates predating the provenance columns, or a source added to the
      // database that this build does not know about yet. Either way it cannot
      // be judged, so it must not be dressed up as if it could.
      return "unsourced";
  }
}

/** Keep batches small — the handler caps at 25 and each store is a round trip. */
export const GEOCODE_BATCH = 10;

export async function geocodeBatch(
  storeIds: string[]
): Promise<GeocodeCandidate[]> {
  const res = await fetch("/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeIds }),
  });

  // Read as text first: an error page is HTML, and .json() on it throws a
  // parse error that hides the real status.
  const raw = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Unexpected ${res.status} response from the geocoder.`);
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return (body as { candidates: GeocodeCandidate[] }).candidates;
}

/**
 * Writes accepted coordinates, recording where each came from.
 *
 * Sequential rather than parallel: this follows the lost-write found during
 * auto-spread, where a handful of concurrent updates silently did not land.
 * Geocoding runs once per store in its lifetime, so throughput is worth
 * nothing and certainty is worth a lot.
 *
 * [sourceOverride] replaces what the service reported rather than filling in
 * for it. That distinction matters: a candidate carrying coordinates always has
 * a non-null `source` from `/api/geocode`, so the old `c.source ?? source`
 * fallback could never fire and the parameter did nothing. Passing "manual"
 * now records that a person looked at the map and accepted the point, which is
 * a different and better fact than which service first proposed it.
 *
 * **An automatic apply refuses to overrule a person.** Passing `"manual"` marks
 * the write as a human decision and lifts the guard; without it, this will not
 * touch a store whose location has been confirmed, nor one whose coordinates
 * were cleared after somebody judged the match wrong.
 *
 * That guard exists because its absence cost real data. A re-run of this
 * function walked 48 stores and re-applied the identical wrong matches to the
 * 31 whose coordinates had been deliberately cleared — the count of stores
 * sharing a coordinate went from 18 pairs to 27 points, eight of them with
 * three or more branches collapsed together. `clearCoordinates` preserves
 * `geocode_result` precisely so that cannot happen, and until now only a
 * comment asked anyone to honour it.
 */
export async function applyCandidates(
  supabase: SupabaseClient,
  candidates: GeocodeCandidate[],
  sourceOverride?: "manual"
): Promise<number> {
  const byHand = sourceOverride === "manual";
  let applied = 0;
  for (const c of candidates) {
    if (c.lat === null || c.lng === null) continue;

    let q = supabase
      .from("stores")
      .update({
        lat: c.lat,
        lng: c.lng,
        geocoded_at: new Date().toISOString(),
        geocode_source: sourceOverride ?? c.source ?? "places",
        // Kept even when a person accepted it: what Google matched is now what
        // someone endorsed, and that is worth being able to re-read later.
        geocode_result: c.matched,
      })
      .eq("id", c.storeId);

    if (!byHand) {
      // Enforced in the WHERE clause rather than a read-then-write, so two
      // runs at once cannot both decide a store is fair game.
      q = q.is("location_confirmed_at", null).is("geocode_result", null);
    }

    // `.select("id")` is what makes a skipped store visible: a PostgREST update
    // matching nothing succeeds silently, so without this the caller would be
    // told 48 were saved when 31 were refused.
    const { data, error } = await q.select("id");
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) > 0) applied += 1;
  }
  return applied;
}

/**
 * Stores an automatic geocode will refuse to touch, and why.
 *
 * The dialog needs this to report honestly — "13 saved, 31 already ruled on" —
 * rather than presenting a skipped store as a failure or, worse, as a success.
 */
export function isProtectedFromAutoGeocode(s: {
  location_confirmed_at?: string | null;
  geocode_result?: string | null;
}): boolean {
  return Boolean(s.location_confirmed_at) || Boolean(s.geocode_result);
}

/** For eyeballing a proposed point before accepting it. */
export function mapsPreview(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export type SharedPointStore = {
  id: string;
  name: string;
  city: string | null;
  /** What the service said it matched. The evidence of a collapse. */
  result: string | null;
  source: string | null;
};

export type SharedPoint = {
  lat: number;
  lng: number;
  stores: SharedPointStore[];
  /**
   * Every store on this point matched the identical listing.
   *
   * This is the difference between a collapse and a coincidence. Two branches
   * that genuinely share a shopping centre matched two different listings that
   * happen to be close; two branches Google could not tell apart matched the
   * same one, and at most one of them is where the app thinks it is.
   */
  sameResult: boolean;
};

/**
 * Stores that landed on exactly the same coordinate as another store.
 *
 * The town cross-check catches a match in the wrong town; it is blind to a
 * match on the wrong branch *within* the right town. Places does that
 * regularly — asked for "Liquorama Kgale" it may return the chain's generic
 * listing, which is in Gaborone and therefore passes the town test, but is the
 * identical point it also returns for Liquorama Main Mall and Liquorama BBS.
 *
 * Four branches on one coordinate is not a location for any of them: a rep
 * checking in at one is inside the geofence of all four, and three of those
 * geofences are somewhere the shop is not. Genuine cases exist — two numbered
 * branches in one shopping centre — so this reports rather than deletes.
 *
 * `sameResult` is what tells those two cases apart, and it is a far better
 * signal than group size: every shared point in this estate today is a pair,
 * and 17 of the 18 pairs hold the identical matched listing.
 */
export function findSharedPoints(
  stores: {
    id: string;
    name: string;
    city: string | null;
    lat: number | null;
    lng: number | null;
    geocode_result?: string | null;
    geocode_source?: string | null;
  }[]
): SharedPoint[] {
  const byPoint: Record<string, SharedPoint> = {};
  for (const s of stores) {
    if (s.lat === null || s.lng === null) continue;
    // Five decimals is a little over a metre — finer than any geofence here,
    // so this groups only genuinely identical answers.
    const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
    (byPoint[key] ??= {
      lat: s.lat,
      lng: s.lng,
      stores: [],
      sameResult: false,
    }).stores.push({
      id: s.id,
      name: s.name,
      city: s.city,
      result: s.geocode_result ?? null,
      source: s.geocode_source ?? null,
    });
  }
  return Object.values(byPoint)
    .filter((p) => p.stores.length > 1)
    .map((p) => ({
      ...p,
      // A null result proves nothing either way, so it never counts as a match —
      // two stores with no recorded match are not evidence of a collapse.
      sameResult:
        p.stores[0].result !== null &&
        p.stores.every((s) => s.result === p.stores[0].result),
    }))
    .sort((a, b) => b.stores.length - a.stores.length);
}

/**
 * Removes a coordinate while keeping what was attempted.
 *
 * `geocode_result` is deliberately preserved: the store goes back to having no
 * location, which is honest, but the wrong answer stays on record so nobody
 * re-runs the same lookup and accepts the same bad match.
 *
 * `geocoded_at`, `geocode_accuracy_m` and `geocode_visit_id` are left behind for
 * the same reason — they are the rest of that record, and `geocode_visit_id` in
 * particular still names the rep who placed a location that was later withdrawn.
 * Only `lat`, `lng` and `geocode_source` describe the present, which is why
 * `geocodeState` reads coordinates first and treats everything else as evidence.
 * Do not "tidy" these to null: it would erase the history this exists to keep.
 */
export async function clearCoordinates(
  supabase: SupabaseClient,
  storeIds: string[]
): Promise<number> {
  let cleared = 0;
  for (const id of storeIds) {
    const { data, error } = await supabase
      .from("stores")
      .update({ lat: null, lng: null, geocode_source: null })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) > 0) cleared += 1;
  }
  return cleared;
}
