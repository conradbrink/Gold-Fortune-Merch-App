import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { PingSource } from "@/lib/live-reps";
import { DEFAULT_TERMS, lower, type Terms } from "@/lib/terms";

/**
 * One rep's day: the trail, the shops, the orders, and the totals.
 *
 * Built only from what already exists — `location_pings`, `visits`, `orders`
 * and `workday_trail` — so nothing here can disagree with the workday summary
 * or the attendance report. Distance and active time come from
 * `workday_trail`, which drops implausible legs and is what the rep's own
 * workday summary shows; the line on the map is every usable ping, so a
 * manager can see what the distance was measured from.
 */

type Client = SupabaseClient<Database>;

export type DayPing = {
  lat: number;
  lng: number;
  recordedAt: string;
  source: PingSource;
  accuracyM: number | null;
};

export type DayVisit = {
  id: string;
  storeName: string;
  lat: number | null;
  lng: number | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  durationSeconds: number | null;
  distanceFromStoreM: number | null;
};

export type DayOrder = {
  id: string;
  orderNumber: string;
  createdAt: string;
  storeName: string;
  lat: number | null;
  lng: number | null;
  status: string;
};

export type RepDay = {
  pings: DayPing[];
  visits: DayVisit[];
  orders: DayOrder[];
  /** Metres, from `workday_trail`; null when no workday was recorded. */
  distanceM: number | null;
  /** Seconds of workday, from `workday_trail`; an open day counts up to now. */
  activeSeconds: number | null;
  /** A workday that started on this date has not been ended yet. */
  dayOpen: boolean;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** Local midnight to local midnight for a YYYY-MM-DD date. */
export function dayBounds(date: string) {
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type StoreEmbed = { name: string; lat: number | null; lng: number | null } | null;

/** The name shown for a shop whose row the caller cannot see or no longer exists. */
function unknownSite(t: Terms) {
  return `Unknown ${lower(t.site.one)}`;
}

export async function fetchRepDay(
  supabase: Client,
  repId: string,
  date: string,
  /** The company's words; the neutral defaults until every caller passes them. */
  t: Terms = DEFAULT_TERMS
): Promise<RepDay> {
  const { from, to } = dayBounds(date);
  const unknown = unknownSite(t);
  const [pings, visits, orders, trail] = await Promise.all([
    supabase
      .from("location_pings")
      .select("lat, lng, recorded_at, source, accuracy_m")
      .eq("rep_id", repId)
      .gte("recorded_at", from)
      .lt("recorded_at", to)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("recorded_at")
      .limit(5000),
    supabase
      .from("visits")
      .select(
        "id, checkin_at, checkout_at, duration_seconds, checkin_distance_from_store_m, stores!visits_store_id_fkey(name, lat, lng)"
      )
      .eq("rep_id", repId)
      .gte("checkin_at", from)
      .lt("checkin_at", to)
      .order("checkin_at"),
    supabase
      .from("orders")
      .select("id, order_number, created_at, status, stores(name, lat, lng)")
      .eq("rep_id", repId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at"),
    supabase.rpc("workday_trail", { p_from: from, p_to: to }),
  ]);
  fail(pings.error);
  fail(visits.error);
  fail(orders.error);
  fail(trail.error);

  const sessions = (trail.data ?? []).filter((t) => t.rep_id === repId);

  return {
    pings: ((pings.data ?? []) as {
      lat: number;
      lng: number;
      recorded_at: string;
      source: PingSource;
      accuracy_m: number | null;
    }[]).map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      recordedAt: p.recorded_at,
      source: p.source,
      accuracyM: p.accuracy_m,
    })),
    visits: ((visits.data ?? []) as unknown as {
      id: string;
      checkin_at: string | null;
      checkout_at: string | null;
      duration_seconds: number | null;
      checkin_distance_from_store_m: number | null;
      stores: StoreEmbed;
    }[]).map((v) => ({
      id: v.id,
      storeName: v.stores?.name ?? unknown,
      lat: v.stores?.lat ?? null,
      lng: v.stores?.lng ?? null,
      checkinAt: v.checkin_at,
      checkoutAt: v.checkout_at,
      durationSeconds: v.duration_seconds,
      distanceFromStoreM: v.checkin_distance_from_store_m,
    })),
    orders: ((orders.data ?? []) as unknown as {
      id: string;
      order_number: string;
      created_at: string;
      status: string;
      stores: StoreEmbed;
    }[]).map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      createdAt: o.created_at,
      storeName: o.stores?.name ?? unknown,
      lat: o.stores?.lat ?? null,
      lng: o.stores?.lng ?? null,
      status: o.status,
    })),
    distanceM: sessions.length ? sessions.reduce((n, s) => n + Number(s.trail_m ?? 0), 0) : null,
    activeSeconds: sessions.length ? sessions.reduce((n, s) => n + sessionSeconds(s, to), 0) : null,
    dayOpen: sessions.some((s) => !s.ended_at),
  };
}

/**
 * How long one workday session has run.
 *
 * `duration_seconds` is written only when a day is ended, so an open day read
 * from it is 0h 0m — which is what the Tracking card showed for a rep halfway
 * through their round. An open session is counted from its start to now, and
 * one left open on an earlier date (nobody pressed End) to the end of that
 * date, so it cannot keep growing for days.
 */
function sessionSeconds(
  s: { started_at: string; ended_at: string | null; duration_seconds: number | null },
  dayEnd: string
) {
  if (s.duration_seconds != null && s.ended_at) return Number(s.duration_seconds);
  const start = new Date(s.started_at).getTime();
  const end = s.ended_at
    ? new Date(s.ended_at).getTime()
    : Math.min(Date.now(), new Date(dayEnd).getTime());
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Every order placed today with a store position, for the live map's order layer. */
export async function fetchTodaysOrders(supabase: Client, t: Terms): Promise<DayOrder[]> {
  const { from, to } = dayBounds(todayDate());
  const unknown = unknownSite(t);
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, created_at, status, stores(name, lat, lng)")
    .gte("created_at", from)
    .lt("created_at", to)
    .neq("status", "cancelled")
    .order("created_at")
    .limit(500);
  fail(error);
  return ((data ?? []) as unknown as {
    id: string;
    order_number: string;
    created_at: string;
    status: string;
    stores: StoreEmbed;
  }[]).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    createdAt: o.created_at,
    storeName: o.stores?.name ?? unknown,
    lat: o.stores?.lat ?? null,
    lng: o.stores?.lng ?? null,
    status: o.status,
  }));
}

export type TimelineEntry = { at: string; kind: "start" | "end" | "checkin" | "checkout" | "order"; text: string; href?: string };

/** The day in order: workday start and end, shops in and out, orders taken. */
export function timelineOf(day: RepDay): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const p of day.pings) {
    if (p.source === "workday_start") out.push({ at: p.recordedAt, kind: "start", text: "Started the day" });
    if (p.source === "workday_end") out.push({ at: p.recordedAt, kind: "end", text: "Ended the day" });
  }
  for (const v of day.visits) {
    if (v.checkinAt) out.push({ at: v.checkinAt, kind: "checkin", text: `Arrived at ${v.storeName}` });
    if (v.checkoutAt) out.push({ at: v.checkoutAt, kind: "checkout", text: `Left ${v.storeName}` });
  }
  for (const o of day.orders) {
    out.push({ at: o.createdAt, kind: "order", text: `Order ${o.orderNumber} at ${o.storeName}`, href: `/orders/${o.id}` });
  }
  // By instant, not by string: timestamps arrive with differing fractional
  // precision, and two in the same second can sort the wrong way as text.
  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function formatKm(m: number | null) {
  return m == null ? "—" : `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number | null) {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
