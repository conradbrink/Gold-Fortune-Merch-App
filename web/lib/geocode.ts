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
 */
export async function applyCandidates(
  supabase: SupabaseClient,
  candidates: GeocodeCandidate[],
  source: "places" | "geocoding" | "manual" = "places"
): Promise<number> {
  let applied = 0;
  for (const c of candidates) {
    if (c.lat === null || c.lng === null) continue;
    const { data, error } = await supabase
      .from("stores")
      .update({
        lat: c.lat,
        lng: c.lng,
        geocoded_at: new Date().toISOString(),
        geocode_source: c.source ?? source,
        geocode_result: c.matched,
      })
      .eq("id", c.storeId)
      .select("id");
    if (error) throw new Error(error.message);
    if ((data?.length ?? 0) > 0) applied += 1;
  }
  return applied;
}

/** For eyeballing a proposed point before accepting it. */
export function mapsPreview(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export type SharedPoint = {
  lat: number;
  lng: number;
  stores: { id: string; name: string; city: string | null }[];
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
 */
export function findSharedPoints(
  stores: { id: string; name: string; city: string | null; lat: number | null; lng: number | null }[]
): SharedPoint[] {
  const byPoint: Record<string, SharedPoint> = {};
  for (const s of stores) {
    if (s.lat === null || s.lng === null) continue;
    // Five decimals is a little over a metre — finer than any geofence here,
    // so this groups only genuinely identical answers.
    const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
    (byPoint[key] ??= { lat: s.lat, lng: s.lng, stores: [] }).stores.push({
      id: s.id,
      name: s.name,
      city: s.city,
    });
  }
  return Object.values(byPoint)
    .filter((p) => p.stores.length > 1)
    .sort((a, b) => b.stores.length - a.stores.length);
}

/**
 * Removes a coordinate while keeping what was attempted.
 *
 * `geocode_result` is deliberately preserved: the store goes back to having no
 * location, which is honest, but the wrong answer stays on record so nobody
 * re-runs the same lookup and accepts the same bad match.
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
