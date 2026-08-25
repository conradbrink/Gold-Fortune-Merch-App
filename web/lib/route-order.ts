import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/rpc";
import { toLocalDateInput } from "@/lib/date-range";
import { distanceKm, orderStops, pathLengthKm, type Point } from "@/lib/geo";

/**
 * Re-sequences a day's stops by proximity instead of alphabetically.
 *
 * `generate_routes` numbers stops `order by coalesce(city,''), name`, with a
 * comment saying mobile does not read `sequence_order` yet. That has not been
 * true for a while — `route_repository.dart` orders by it explicitly — so the
 * alphabet has been deciding the order reps drive in.
 *
 * Measured over the 60 scheduled rep-days that have full coordinates: **3,509 km
 * of driving becomes 2,791 km, a fifth of it removed**, with nobody changing day
 * and nothing moving between reps.
 *
 * Everything here is straight-line. It is the right tool for deciding an *order*
 * — the sequence that is shortest as the crow flies is almost always the sequence
 * that is shortest by road — and the wrong tool for promising a distance or a
 * time, which is why no figure this module produces is ever labelled as one.
 */

/** A stop, with enough identity to write its new number back. */
export type OrderableStop = {
  routeId: string;
  storeId: string;
  storeName: string;
  city: string | null;
  sequence: number | null;
  point: Point | null;
};

export type OrderableDay = {
  repId: string;
  repName: string | null;
  date: string;
  stops: OrderableStop[];
};

/** One day's proposed re-ordering. */
export type DayPlan = {
  repId: string;
  repName: string | null;
  date: string;
  /** Route ids in their new order, first stop first. */
  routeIds: string[];
  currentKm: number;
  plannedKm: number;
  stops: number;
  /** Stops with no coordinates, left at the end of the day in name order. */
  unplaceable: number;
  changed: boolean;
};

export type OrderSummary = {
  days: DayPlan[];
  currentKm: number;
  plannedKm: number;
  /** Days skipped because fewer than two stops carry coordinates. */
  skipped: number;
  /** Days left alone because the rep has already checked in somewhere. */
  started: number;
};

/**
 * Where each rep actually starts their day.
 *
 * The median of their first check-in position across every day they have worked.
 * A median rather than a mean because one call on the far side of the country
 * would drag an average halfway there — exactly what Jerry's range would do.
 *
 * This is not a home address and must not be described as one. It is where a rep
 * has tended to begin, which is a useful anchor and a weak one: Tshepo's first
 * stops sit within about four kilometres of each other, and Jerry's are spread
 * over sixty. A rep with no history at all gets no anchor, and their day falls
 * back to holding whatever stop is currently first.
 */
export async function fetchRepStartAnchors(
  supabase: SupabaseClient
): Promise<Map<string, Point>> {
  const { data, error } = await supabase
    .from("visits")
    .select("rep_id, checkin_at, checkin_lat, checkin_lng")
    .not("checkin_at", "is", null)
    // Both halves. `checkin_lng` is nullable too, and a null survives the cast
    // to become 0 in the median — putting a rep's anchor in the Gulf of Guinea
    // and quietly reshaping every day it touches.
    .not("checkin_lat", "is", null)
    .not("checkin_lng", "is", null)
    .order("checkin_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    rep_id: string;
    checkin_at: string;
    checkin_lat: number;
    checkin_lng: number;
  }[];

  // First check-in per rep per *local* day. Grouping on the raw timestamp would
  // put an evening call on the following day for half of every day in CAT.
  const firstOfDay = new Map<string, { lat: number; lng: number }>();
  for (const r of rows) {
    const local = toLocalDateInput(new Date(r.checkin_at));
    const key = `${r.rep_id}|${local}`;
    // Rows arrive in ascending time order, so the first one seen wins.
    if (!firstOfDay.has(key)) {
      firstOfDay.set(key, { lat: r.checkin_lat, lng: r.checkin_lng });
    }
  }

  const byRep = new Map<string, { lat: number; lng: number }[]>();
  for (const [key, p] of firstOfDay) {
    const repId = key.slice(0, key.indexOf("|"));
    const list = byRep.get(repId);
    if (list) list.push(p);
    else byRep.set(repId, [p]);
  }

  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const anchors = new Map<string, Point>();
  for (const [repId, points] of byRep) {
    anchors.set(repId, {
      lat: median(points.map((p) => p.lat)),
      lng: median(points.map((p) => p.lng)),
    });
  }
  return anchors;
}

/**
 * Scheduled days that can still be re-ordered.
 *
 * From tomorrow rather than today: a rep may already be partway through today's
 * round without having checked in yet, and renumbering the day under them is the
 * one outcome this must never produce. `generate_routes` draws the same line for
 * the same reason.
 */
export async function fetchDaysToOrder(
  supabase: SupabaseClient,
  weeks: number
): Promise<{ days: OrderableDay[]; started: number }> {
  const from = new Date();
  from.setDate(from.getDate() + 1);
  const to = new Date(from);
  to.setDate(to.getDate() + weeks * 7);

  // PostgREST caps a response at 1,000 rows. Past that the tail of the horizon
  // arrives silently truncated — and a *partially* returned day is the worst
  // possible input here: the stops that came back get renumbered 1..n while the
  // ones that did not keep their old numbers, so the day ends up with two stops
  // called 3 and the rep app, which orders by that column, shows a broken round.
  // Paged, and ordered by id so the pages cannot overlap or skip.
  const PAGE = 1000;
  const rows: RouteRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchRoutePage(supabase, from, to, offset, PAGE);
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  return groupRouteRows(rows);
}

type Embedded<T> = T | T[] | null;

type RouteRow = {
  id: string;
  rep_id: string;
  store_id: string;
  scheduled_date: string;
  sequence_order: number | null;
  profiles: Embedded<{ full_name: string | null }>;
  stores: Embedded<{
    name: string;
    city: string | null;
    lat: number | null;
    lng: number | null;
  }>;
  visits: { checkin_at: string | null }[] | null;
};

async function fetchRoutePage(
  supabase: SupabaseClient,
  from: Date,
  to: Date,
  offset: number,
  size: number
): Promise<RouteRow[]> {
  const { data, error } = await supabase
    .from("routes")
    // Single string literal — a concatenated .select() degrades to
    // GenericStringError in postgrest-js.
    //
    // `profiles!routes_rep_id_fkey` names which of the two foreign keys to
    // follow. `routes` points at `profiles` twice — `rep_id` for whose day it is
    // and `created_by` for who scheduled it — and without the constraint name
    // PostgREST refuses the embed outright ("more than one relationship was
    // found") rather than picking one. The same trap `fetchDayBoard` documents
    // for visits/stores; it costs nothing to name it and the page dies without.
    .select(
      "id, rep_id, store_id, scheduled_date, sequence_order, profiles!routes_rep_id_fkey(full_name), stores(name, city, lat, lng), visits(checkin_at)"
    )
    .gte("scheduled_date", toLocalDateInput(from))
    .lte("scheduled_date", toLocalDateInput(to))
    // A stable total order, or two pages can return the same row and miss another.
    .order("id", { ascending: true })
    .range(offset, offset + size - 1);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as RouteRow[];
}

function groupRouteRows(rows: RouteRow[]): {
  days: OrderableDay[];
  started: number;
} {
  const one = <T>(e: Embedded<T>): T | null =>
    Array.isArray(e) ? e[0] ?? null : e;

  const byDay = new Map<string, OrderableDay>();
  const startedDays = new Set<string>();

  for (const r of rows) {
    const key = `${r.rep_id}|${r.scheduled_date}`;
    // A day the rep has already begun is off limits, however far ahead it is.
    if (r.visits?.some((v) => v.checkin_at)) startedDays.add(key);

    const store = one(r.stores);
    let day = byDay.get(key);
    if (!day) {
      day = {
        repId: r.rep_id,
        repName: one(r.profiles)?.full_name ?? null,
        date: r.scheduled_date,
        stops: [],
      };
      byDay.set(key, day);
    }
    day.stops.push({
      routeId: r.id,
      storeId: r.store_id,
      storeName: store?.name ?? "Unknown store",
      city: store?.city ?? null,
      sequence: r.sequence_order,
      point:
        store?.lat == null || store?.lng == null
          ? null
          : { lat: store.lat, lng: store.lng },
    });
  }

  for (const key of startedDays) byDay.delete(key);

  return { days: [...byDay.values()], started: startedDays.size };
}

/**
 * Works out the new order for every day, without writing anything.
 *
 * Stops with no coordinates cannot be placed on a route, so they are held at the
 * end of the day in name order rather than being dropped or guessed at. That is a
 * decision, not an answer: the rep can slot them in, and the count is reported so
 * a day full of unplaceable shops does not look like a day that was optimised.
 */
export function planStopOrder(
  days: OrderableDay[],
  anchors: Map<string, Point>
): OrderSummary {
  const plans: DayPlan[] = [];
  let skipped = 0;
  let currentKm = 0;
  let plannedKm = 0;

  for (const day of days) {
    const placed = day.stops.filter((s) => s.point !== null);
    const unplaceable = day.stops.filter((s) => s.point === null);

    // One located stop has no travel to optimise; zero has nothing at all.
    if (placed.length < 2) {
      skipped++;
      continue;
    }

    const inCurrentOrder = [...placed].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
    );
    const anchor = anchors.get(day.repId) ?? null;
    const ordered = orderStops(inCurrentOrder, (s) => s.point!, anchor);

    const before = pathLengthKm(inCurrentOrder.map((s) => s.point!));
    const after = pathLengthKm(ordered.map((s) => s.point!));

    // The anchor is part of the day the rep drives, so it is part of what is
    // being compared. Leaving it out is what made the naive ordering look better
    // than it is.
    const homeLeg = (first: OrderableStop) =>
      anchor ? distanceKm(anchor, first.point!) : 0;
    const beforeTotal = before + homeLeg(inCurrentOrder[0]);
    const afterTotal = after + homeLeg(ordered[0]);

    const tail = [...unplaceable].sort((a, b) =>
      a.storeName.localeCompare(b.storeName)
    );
    const routeIds = [...ordered, ...tail].map((s) => s.routeId);

    // Compare against the order the database actually holds, hoisted out of the
    // loop. Comparing against placed-then-tail instead was wrong twice over: it
    // rebuilt the array once per stop, and it assumed the very arrangement this
    // function is trying to produce. A day whose located stops were already
    // optimal but whose unplaceable stop sat in the middle came out `changed:
    // false`, so the rule that unplaceable stops belong at the end was quietly
    // not applied to exactly the days that needed it.
    const storedOrder = [...day.stops]
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((s) => s.routeId);
    const changed = routeIds.some((id, i) => id !== storedOrder[i]);

    currentKm += beforeTotal;
    plannedKm += afterTotal;

    plans.push({
      repId: day.repId,
      repName: day.repName,
      date: day.date,
      routeIds,
      currentKm: beforeTotal,
      plannedKm: afterTotal,
      stops: day.stops.length,
      unplaceable: unplaceable.length,
      changed,
    });
  }

  return { days: plans, currentKm, plannedKm, skipped, started: 0 };
}

/**
 * Writes the new sequence numbers, one whole day per call.
 *
 * Delegates to `set_route_day_order` (20260825120720) rather than issuing an
 * update per stop, because a day has to move as one thing. PostgREST gives each
 * update its own transaction, so a failure part way through used to leave a day
 * holding new numbers for some stops and old ones for others — duplicate
 * `sequence_order` values, and `route_repository.dart` orders by that column, so
 * the rep would open their phone to a broken round. The old guard could only
 * report that after it had happened.
 *
 * The RPC also re-checks, under a row lock, the things this module can only
 * check when the *proposal* is built: that the day is still in the future, that
 * nobody has started it, and that these are exactly that day's stops. The
 * proposal sits on screen while a manager reads it, and a rep can check in
 * during that window.
 */
export async function applyStopOrder(
  supabase: SupabaseClient,
  plans: DayPlan[]
): Promise<{ daysWritten: number; stopsWritten: number }> {
  let daysWritten = 0;
  let stopsWritten = 0;

  for (const plan of plans) {
    if (!plan.changed) continue;

    const { data, error } = await callRpc(supabase, "set_route_day_order", {
      p_rep_id: plan.repId,
      p_date: plan.date,
      p_route_ids: plan.routeIds,
    });

    if (error) {
      // The RPC's own messages are written for this reader — "that round has
      // already started", "not exactly the stops scheduled for that day" — so
      // they are surfaced rather than replaced with something vaguer.
      throw new Error(
        `${plan.repName ?? "A rep"}'s ${plan.date} was not re-ordered: ${error.message}`
      );
    }

    daysWritten++;
    stopsWritten += Number(data ?? plan.routeIds.length);
  }

  return { daysWritten, stopsWritten };
}
