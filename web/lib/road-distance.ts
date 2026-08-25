import { distanceKm, type Point } from "@/lib/geo";

/**
 * Turning a day's GPS pings into the distance actually driven.
 *
 * ## Why the Routes API and not Snap to Roads
 *
 * Snap to Roads is the obvious choice and it is the wrong one here. Google's own
 * guidance is to "provide paths on which consecutive pairs of points are within
 * 300m of each other" — our pings are five minutes apart, which at 60 km/h is
 * about **5,000 m, sixteen times that**. Snapping points that sparse produces
 * exactly the "odd snapping behaviour" the documentation warns about, because
 * the algorithm has no evidence of which road was taken between them.
 *
 * `computeRoutes` answers a different and better-posed question: given these two
 * points, what is the driving distance between them. For a five-minute gap there
 * are rarely meaningfully different answers, so the route it returns is a close
 * stand-in for the one actually driven — and always closer than the straight
 * line, which cuts every corner and every bend.
 *
 * ## Why ten intermediates and not twenty-five
 *
 * The method takes up to 25 intermediate waypoints, but **11 or more is billed at
 * a higher rate**. Ten keeps every request in the cheaper tier at the cost of a
 * few more of them, which is the right trade when the whole point is a bill
 * nobody has to think about.
 */

/** Google's cheap tier ends at 11 intermediates. Stay one under it. */
export const MAX_INTERMEDIATES = 10;

/**
 * Pings close enough together to be noise rather than travel.
 *
 * Sampling on time means a parked phone still reports, and routing between two
 * points twenty metres apart bills a request to learn that a rep crossed a car
 * park. Dropped before batching, using the same 50 m floor the phone's own
 * odometer applies.
 */
export const MIN_LEG_M = 50;

export type Ping = { lat: number; lng: number; recordedAt: string };

/**
 * Drops pings that are not far enough from the last kept one to be travel.
 *
 * Deliberately measured against the last **kept** ping, not the previous one: a
 * rep drifting five metres at a time would otherwise never trip the floor and
 * the whole afternoon would collapse to a single point.
 */
export function thinPings(pings: Ping[], minMetres = MIN_LEG_M): Ping[] {
  const kept: Ping[] = [];
  for (const p of pings) {
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(p);
      continue;
    }
    const metres = distanceKm(last as Point, p as Point) * 1000;
    if (metres >= minMetres) kept.push(p);
  }
  return kept;
}

/**
 * Splits a day into requests, each an origin, up to ten intermediates and a
 * destination.
 *
 * Consecutive batches **share a point**: the destination of one is the origin of
 * the next. Without the overlap the leg between the last point of one batch and
 * the first of the next is never routed, and a day quietly loses one leg per
 * batch — around ten kilometres on a normal day, always in the same direction.
 */
export function batchForRouting(points: Ping[], size = MAX_INTERMEDIATES): Ping[][] {
  if (points.length < 2) return [];
  const perBatch = size + 2;
  const batches: Ping[][] = [];
  for (let i = 0; i < points.length - 1; i += perBatch - 1) {
    const batch = points.slice(i, i + perBatch);
    if (batch.length >= 2) batches.push(batch);
  }
  return batches;
}

type RoutesResponse = {
  routes?: { distanceMeters?: number }[];
  error?: { message?: string };
};

/**
 * One `computeRoutes` call. Returns metres, or throws with Google's own message.
 *
 * The field mask is mandatory and deliberately minimal — asking only for
 * `routes.distanceMeters` keeps the response small and, more importantly, keeps
 * the request inside the billing tier that mask implies. Requesting polylines or
 * legs here would cost more for data nothing reads.
 */
export async function routeDistanceMetres(
  batch: Ping[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<number> {
  const waypoint = (p: Ping) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });

  const res = await fetchImpl(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: waypoint(batch[0]),
        destination: waypoint(batch[batch.length - 1]),
        intermediates: batch.slice(1, -1).map(waypoint),
        travelMode: "DRIVE",
        // The rep drove this hours ago; asking for live traffic would price a
        // journey nobody is making now, and costs more.
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    }
  );

  const body = (await res.json()) as RoutesResponse;
  if (!res.ok) {
    throw new Error(body.error?.message ?? `Routes API returned ${res.status}.`);
  }
  const metres = body.routes?.[0]?.distanceMeters;
  // No route is a real answer, not an error: two points either side of a border
  // post, or a shop reached down a track Google does not have. Zero would claim
  // the rep did not move.
  if (typeof metres !== "number") {
    throw new Error("The Routes API returned no route for part of this day.");
  }
  return metres;
}

/**
 * The whole day, in metres.
 *
 * Every batch must succeed. A partial sum is the worst possible output — it
 * looks like a real figure, it is always an undercount, and nothing downstream
 * could tell it apart from a short day.
 */
export async function computeDayRoadMetres(
  pings: Ping[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ metres: number; requests: number }> {
  const thinned = thinPings(pings);
  const batches = batchForRouting(thinned);
  if (batches.length === 0) return { metres: 0, requests: 0 };

  let metres = 0;
  for (const batch of batches) {
    metres += await routeDistanceMetres(batch, apiKey, fetchImpl);
  }
  return { metres, requests: batches.length };
}
