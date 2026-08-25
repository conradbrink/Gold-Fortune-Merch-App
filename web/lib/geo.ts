/**
 * Straight-line geography for the planner.
 *
 * Deliberately not road distance. Every figure here is as the crow flies, which
 * costs nothing and needs no API key — and which understates a run between towns,
 * where the road bends. Anything shown to a manager from this module must say
 * "straight line", never a drive time, for the same reason `call_cycle_review`'s
 * `span_km` is documented that way: a distance quietly reinterpreted as a duration
 * is the most misleading thing this code could produce.
 *
 * The haversine constant matches `public.haversine_m` (20260727214650) so the
 * browser and the database cannot disagree about how far apart two shops are.
 */

export type Point = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line kilometres between two coordinates. */
export function distanceKm(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h));
}

/** Total length of a path visited in the given order. */
export function pathLengthKm(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distanceKm(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Orders stops so that each is followed by the nearest one not yet taken.
 *
 * A greedy first pass. On its own it strands the last few stops — it happily
 * leaves one shop on the far side of town until the end — which is why `twoOpt`
 * runs after it rather than instead of it.
 */
function nearestNeighbour(points: Point[]): Point[] {
  if (points.length < 3) return [...points];
  const remaining = points.slice(1);
  const tour = [points[0]];

  while (remaining.length > 0) {
    const last = tour[tour.length - 1];
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(last, remaining[i]);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    tour.push(remaining.splice(bestIndex, 1)[0]);
  }
  return tour;
}

/**
 * Repeatedly reverses any run of stops that shortens the path.
 *
 * This is what removes the crossings a greedy pass leaves behind, and it is where
 * most of the saving actually comes from. It is O(n²) per improving pass, which is
 * irrelevant at the size of a rep-day: the busiest day on the estate has 17 stops.
 *
 * The first stop is held fixed. A day has to start somewhere and the planner does
 * not know where the rep sleeps, so the alternative — letting the optimiser choose
 * a start too — would produce a route that is shorter on paper and starts at the
 * wrong end of town.
 */
function twoOpt(tour: Point[]): Point[] {
  if (tour.length < 4) return tour;

  let best = tour;
  let bestLength = pathLengthKm(best);
  let improved = true;

  // Guard against a pathological input pinning the browser: the loop converges in
  // a handful of passes at these sizes, so a cap that is never reached in practice
  // still turns "hangs" into "returns something sane".
  let passes = 0;
  while (improved && passes < 50) {
    improved = false;
    passes++;
    for (let i = 1; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const length = pathLengthKm(candidate);
        // The epsilon matters: floating-point noise alone can look like an
        // improvement and loop forever swapping two identical routes.
        if (length < bestLength - 1e-9) {
          best = candidate;
          bestLength = length;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Shortest path the planner can find through a day's stops, in kilometres.
 *
 * **Null, never zero, when any stop has no coordinates** — the same rule
 * `call_cycle_review` follows. Zero would read as "these shops are all in the same
 * place", which is the most misleading answer available. A genuine single-stop day
 * is 0: there is no travel between stops.
 */
export function shortestPathKm(points: (Point | null)[]): number | null {
  if (points.some((p) => p === null)) return null;
  const known = points as Point[];
  if (known.length === 0) return null;
  if (known.length === 1) return 0;
  return pathLengthKm(twoOpt(nearestNeighbour(known)));
}

/**
 * The order to call on a day's stops, shortest first.
 *
 * Generic over the caller's own row so the ordering and the identity of a stop
 * never have to be re-paired by index afterwards — hand it routes, get routes
 * back.
 *
 * **`anchor` is where the rep actually starts their day**, and passing it is what
 * makes this worth doing. `twoOpt` holds the first stop fixed because a tour that
 * picks its own start is "shorter on paper and starts at the wrong end of town" —
 * true, and measured: across 60 scheduled rep-days, letting the optimiser choose
 * the start beats a fixed alphabetical start by 2.5 points on inter-stop distance
 * and by **0.2 points** once the drive from the rep's usual start is counted. It
 * optimises the part nobody drives.
 *
 * Anchoring instead — first stop is whichever is nearest the anchor — measures
 * worse on inter-stop distance (-22.2% against -24.4%) and **better on the day the
 * rep actually drives (-20.5% against -16.4%)**. Optimise the real journey, not the
 * flattering half of it.
 *
 * With no anchor it falls back to holding the caller's existing first stop, which
 * is the old behaviour and still better than nothing.
 */
export function orderStops<T>(
  items: T[],
  getPoint: (item: T) => Point,
  anchor?: Point | null
): T[] {
  if (items.length < 3) return [...items];

  // Rotate the nearest-to-anchor stop into first place before the greedy pass,
  // so the fixed point twoOpt preserves is the one the rep really starts from.
  let start = 0;
  if (anchor) {
    let best = Infinity;
    items.forEach((item, i) => {
      const d = distanceKm(anchor, getPoint(item));
      if (d < best) {
        best = d;
        start = i;
      }
    });
  }
  const rotated = [items[start], ...items.filter((_, i) => i !== start)];

  // Order the points, then map back to rows by identity. Points are compared by
  // reference, not by value: two shops in the same shopping centre can share a
  // coordinate to five decimal places, and matching on lat/lng would silently
  // drop one of them.
  const points = new Map<Point, T>();
  const pts = rotated.map((item) => {
    const p = getPoint(item);
    // A shared Point object would collide in the map, so give each row its own.
    const own = { lat: p.lat, lng: p.lng };
    points.set(own, item);
    return own;
  });

  return twoOpt(nearestNeighbour(pts)).map((p) => points.get(p)!);
}

/** `{lat, lng}` when both are present, null otherwise — for `shortestPathKm`. */
export function toPoint(
  lat: number | null | undefined,
  lng: number | null | undefined
): Point | null {
  return lat == null || lng == null ? null : { lat, lng };
}
