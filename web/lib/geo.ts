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
  if (items.length < 2) return [...items];

  // Two stops still need the anchor. The leg between them is the same length in
  // either direction, so the only distance in play is the drive from where the
  // rep starts to whichever they call on first — which is precisely what this
  // function exists to shorten. Returning early here left every two-stop day
  // sitting in whatever order the alphabet gave it.
  //
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

/** Mean position of a set of points. Only used to grow and seed clusters. */
function centroid(points: Point[]): Point {
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/**
 * Splits stops into `groupCount` compact groups of roughly equal size.
 *
 * Each group is a day's work, so the property that matters is that a group is
 * tight on the ground — not that the groups are equal, and not that they follow
 * town names. Town names were the old rule and they are a poor proxy: Gaborone
 * and Mogoditshane are five kilometres apart and were treated as a reason to
 * split a day, while two shops sharing a town name forty kilometres apart were
 * treated as one place.
 *
 * **Each group is seeded from the point furthest from what is left**, then grown
 * by repeatedly taking the nearest remaining stop. Seeding from an extremity is
 * what makes an outlying cluster come out as its own group rather than being
 * smeared across several: the far towns get claimed first, together, while there
 * is still room to hold them. Seeding from the middle instead leaves the
 * stragglers to be distributed among whatever groups have space, which is
 * exactly the "one shop on the far side of the country" day this is meant to end.
 */
export function clusterByProximity<T>(
  items: T[],
  getPoint: (item: T) => Point,
  groupCount: number
): T[][] {
  const groups: T[][] = [];
  const wanted = Math.max(1, Math.min(Math.floor(groupCount), items.length));
  if (items.length === 0) return groups;

  // Even sizes, remainder spread one per group. Cutting fixed-size chunks
  // instead leaves a runt at the end — 26 stores in chunks of 8 gives
  // 8, 8, 8 and a **2**, and that 2 costs a whole working day for a rep who
  // still has to drive out and back. Balanced groups of 9, 9, 8 use three.
  const base = Math.floor(items.length / wanted);
  const extra = items.length % wanted;
  const sizes = Array.from({ length: wanted }, (_, i) => base + (i < extra ? 1 : 0));

  const remaining = [...items];
  for (const size of sizes) {
    if (remaining.length === 0) break;
    const rest = remaining.map(getPoint);
    const middle = centroid(rest);

    let seedIndex = 0;
    let furthest = -1;
    remaining.forEach((item, i) => {
      const d = distanceKm(middle, getPoint(item));
      if (d > furthest) {
        furthest = d;
        seedIndex = i;
      }
    });

    const group = [remaining.splice(seedIndex, 1)[0]];
    while (group.length < size && remaining.length > 0) {
      const here = centroid(group.map(getPoint));
      let nearestIndex = 0;
      let nearest = Infinity;
      remaining.forEach((item, i) => {
        const d = distanceKm(here, getPoint(item));
        if (d < nearest) {
          nearest = d;
          nearestIndex = i;
        }
      });
      group.push(remaining.splice(nearestIndex, 1)[0]);
    }
    groups.push(group);
  }

  // Anything left over from rounding joins the nearest existing group.
  for (const item of remaining) {
    let best = groups[0];
    let bestDistance = Infinity;
    for (const g of groups) {
      const d = distanceKm(centroid(g.map(getPoint)), getPoint(item));
      if (d < bestDistance) {
        bestDistance = d;
        best = g;
      }
    }
    best.push(item);
  }

  return groups;
}

/** `{lat, lng}` when both are present, null otherwise — for `shortestPathKm`. */
export function toPoint(
  lat: number | null | undefined,
  lng: number | null | undefined
): Point | null {
  return lat == null || lng == null ? null : { lat, lng };
}
