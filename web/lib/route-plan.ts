import { distanceKm } from "@/lib/geo";

/**
 * A driver's stops in the best order, from where they are standing, by
 * Google (`/api/route-plan`): the Routes API with `optimizeWaypointOrder`,
 * which knows the roads. Paid per call (Compute Routes Pro), so it runs only
 * when the owner has switched it on. Without it the phone orders the stops
 * itself, by straight line (mobile/lib/features/driver/route_plan.dart).
 *
 * Google keeps the origin and the destination where they are and orders only
 * the stops between. A driver's round has no fixed end, so the end is the
 * stop furthest from the driver: the round works its way out to it.
 *
 * A stop with no pin is sent by its address, which Google can place.
 */

export type LatLng = { lat: number; lng: number };

export type Stop = {
  id: string;
  /** The place's pin, when it has one. */
  at: LatLng | null;
  /** What to search for when there is no pin, or when the order names another address. */
  address: string | null;
};

/** The most stops between origin and end that Google will order in one call. */
export const MAX_INTERMEDIATES = 25;
/** So the most stops one plan can send: the in-between ones and the end. */
export const MAX_STOPS = MAX_INTERMEDIATES + 1;

/** A latitude and longitude that can be a place on Earth. */
export function isLatLng(v: unknown): v is LatLng {
  if (!v || typeof v !== "object") return false;
  const { lat, lng } = v as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

type Waypoint =
  | { location: { latLng: { latitude: number; longitude: number } } }
  | { address: string };

function waypoint(s: Stop): Waypoint {
  // The address wins only when there is no pin: a typed delivery address is
  // already passed as the stop's only way to be found (see the route).
  if (s.at) return { location: { latLng: { latitude: s.at.lat, longitude: s.at.lng } } };
  return { address: s.address! };
}

/**
 * The `computeRoutes` body, and which stop sits where in it.
 *
 * Every stop must have a pin or an address; the route drops the ones with
 * neither before calling this. Needs at least two stops: with one there is
 * nothing to order.
 */
export function routesRequest(
  origin: LatLng,
  stops: Stop[]
): { body: Record<string, unknown>; endId: string; middleIds: string[] } {
  if (stops.length < 2) throw new Error("Two stops or more are needed to plan a route.");
  if (stops.length > MAX_STOPS) throw new Error(`At most ${MAX_STOPS} stops can be planned at once.`);
  // The end: the pinned stop furthest from the driver, else the last one.
  let end = stops.length - 1;
  let far = -1;
  stops.forEach((s, i) => {
    if (!s.at) return;
    const d = distanceKm(origin, s.at);
    if (d > far) {
      far = d;
      end = i;
    }
  });
  const middle = stops.filter((_, i) => i !== end);
  return {
    body: {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: waypoint(stops[end]),
      intermediates: middle.map(waypoint),
      travelMode: "DRIVE",
      // Optimising refuses TRAFFIC_AWARE_OPTIMAL, and traffic would price a
      // journey the driver may start an hour from now.
      routingPreference: "TRAFFIC_UNAWARE",
      optimizeWaypointOrder: true,
    },
    endId: stops[end].id,
    middleIds: middle.map((s) => s.id),
  };
}

export type RoutesAnswer = {
  routes?: {
    optimizedIntermediateWaypointIndex?: number[];
    distanceMeters?: number;
    duration?: string;
  }[];
  error?: { message?: string };
};

/**
 * Stop ids in Google's order, the end last. Null when the answer is not a
 * whole ordering of the stops sent: a plan that drops a stop is worse than
 * nearest first, which never does.
 */
export function orderFromAnswer(
  answer: RoutesAnswer,
  plan: { endId: string; middleIds: string[] }
): { order: string[]; distanceMeters: number | null; durationSeconds: number | null } | null {
  const route = answer.routes?.[0];
  if (!route) return null;
  const idx = route.optimizedIntermediateWaypointIndex ?? [];
  // One intermediate comes back as [] or [0], depending on the day.
  const indexes = plan.middleIds.length <= 1 && idx.length === 0 ? plan.middleIds.map((_, i) => i) : idx;
  if (
    indexes.length !== plan.middleIds.length ||
    new Set(indexes).size !== indexes.length ||
    indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= plan.middleIds.length)
  ) {
    return null;
  }
  const seconds = route.duration ? Number.parseInt(route.duration, 10) : NaN;
  return {
    order: [...indexes.map((i) => plan.middleIds[i]), plan.endId],
    distanceMeters: typeof route.distanceMeters === "number" ? route.distanceMeters : null,
    durationSeconds: Number.isFinite(seconds) ? seconds : null,
  };
}

/** A dispatch as `/api/route-plan` reads it: the order's typed address and the place. */
export type DispatchRow = {
  id: string;
  order: {
    delivery_address: string | null;
    store: {
      name: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      lat: number | null;
      lng: number | null;
    } | null;
  } | null;
};

const text = (v: string | null | undefined) => {
  const s = v?.trim();
  return s ? s : null;
};

/**
 * Where a delivery is going, as the phone's delivery screen finds it
 * (`DeliveryDetail.directions`): an address typed on the order first, because
 * this drop is going somewhere other than the usual place; then the place's
 * pin; then its name and address.
 */
export function stopFor(row: DispatchRow): Stop {
  const store = row.order?.store ?? null;
  const typed = text(row.order?.delivery_address);
  if (typed) return { id: row.id, at: null, address: typed };
  if (store && typeof store.lat === "number" && typeof store.lng === "number") {
    return { id: row.id, at: { lat: store.lat, lng: store.lng }, address: null };
  }
  const parts = [store?.name, store?.address, store?.city, store?.state].map(text).filter(Boolean);
  return { id: row.id, at: null, address: parts.length ? parts.join(", ") : null };
}
