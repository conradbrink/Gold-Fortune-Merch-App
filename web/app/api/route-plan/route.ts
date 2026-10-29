import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseFetch } from "@/lib/supabase/fetch";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import {
  isLatLng,
  MAX_STOPS,
  orderFromAnswer,
  routesRequest,
  plannedIds,
  stopFor,
  stopForRoute,
  type DispatchRow,
  type RouteRow,
  type RoutesAnswer,
} from "@/lib/route-plan";

/**
 * A driver's deliveries, or a rep's visits for the day, in the best driving
 * order, from Google.
 *
 * Called by the phone's "Plan my route" (mobile/lib/features/driver for a
 * driver, mobile/lib/features/route_today for a rep, which also plans once
 * when the workday starts), with the person's own access token: the phone has no cookie, so this reads the
 * `Authorization: Bearer` header and asks Supabase who it belongs to. Server-
 * side because the Google key must never reach a handset, the same reasoning
 * as `/api/geocode` and `/api/workday/road-distance`; `proxy.ts` excludes /api,
 * so this handler owns its auth.
 *
 * **The phone sends ids, never places.** A driver sends dispatch ids, a rep
 * the route ids of their scheduled visits. The stops are read here, through
 * the caller's own client, so RLS answers with only the deliveries assigned to
 * them (`dispatches_select`) or the visits in their company
 * (`routes_select`), and routes are narrowed to the caller's own on top: a
 * manager signed in on a phone plans their own day, not a rep's. An endpoint
 * that routed whatever points it was sent would be a free routing service on
 * the company's key.
 *
 * Both share one limit (`LIMITS.routePlan`), per person: a rep's automatic
 * plan at the start of the day is one of them.
 *
 * **Off until the owner switches it on.** Ordering stops is billed as Compute
 * Routes Pro (US$10 a 1,000 calls, the first 5,000 a month free, Google's
 * list on 29 Oct 2026). With `GOOGLE_ROUTE_PLANNING` not set to `on` this
 * answers 503 and the phone orders the stops nearest-first itself, which is
 * free and works with no signal. Every refusal here leaves the phone on that
 * fallback, so none of them strands a driver.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: supabaseFetch, headers: { Authorization: `Bearer ${token}` } },
      }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    // After auth, so an anonymous caller learns nothing about the set-up.
    const key = process.env.GOOGLE_ROUTES_API_KEY;
    if (process.env.GOOGLE_ROUTE_PLANNING !== "on" || !key) {
      return Response.json(
        { error: "Route planning by Google is not switched on.", fallback: true },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => null)) as { origin?: unknown } | null;
    const origin = body?.origin;
    if (!isLatLng(origin)) {
      return Response.json({ error: "Where you are is missing." }, { status: 400 });
    }
    const asked = plannedIds(body);
    if (!asked) {
      return Response.json({ error: "Send deliveries or stops to plan, not both." }, { status: 400 });
    }
    const { kind, ids } = asked;
    if (ids.length < 2) {
      return Response.json({ error: "Two stops or more are needed to plan a route." }, { status: 400 });
    }
    if (ids.length > MAX_STOPS) {
      return Response.json(
        { error: `Google plans at most ${MAX_STOPS} stops at once.`, fallback: true },
        { status: 400 }
      );
    }

    // Through the caller's own client: RLS returns only their deliveries,
    // and the routes are narrowed to the ones scheduled for them.
    const read =
      kind === "dispatches"
        ? await supabase
            .from("dispatches")
            .select("id, order:orders(delivery_address, store:stores(name, address, city, state, lat, lng))")
            .in("id", ids)
            .eq("status", "in_transit")
        : await supabase
            .from("routes")
            .select("id, store:stores(name, address, city, state, lat, lng)")
            .in("id", ids)
            .eq("rep_id", user.id);
    if (read.error) {
      return Response.json({ error: read.error.message }, { status: 502 });
    }
    const rows = read.data ?? [];
    if (rows.length !== ids.length) {
      return Response.json(
        {
          error:
            kind === "dispatches"
              ? "Some of those deliveries are not yours, or are no longer on the road."
              : "Some of those stops are not on your schedule.",
          fallback: true,
        },
        { status: 409 }
      );
    }
    const stops =
      kind === "dispatches"
        ? (rows as unknown as DispatchRow[]).map(stopFor)
        : (rows as unknown as RouteRow[]).map(stopForRoute);
    if (stops.some((s) => !s.at && !s.address)) {
      return Response.json(
        { error: "A stop has no address to find it by.", fallback: true },
        { status: 422 }
      );
    }

    // Charged after the checks that cost nothing and before the call that
    // does; fails closed, because it is about to bill Google.
    const gate = await enforceRateLimit(supabase, LIMITS.routePlan, 1, { failClosed: true });
    if (!gate.ok) return gate.response;

    const plan = routesRequest(origin, stops);
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        // The order, and the total the screen shows. Nothing else: legs and
        // polylines are data nothing reads.
        "X-Goog-FieldMask":
          "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify(plan.body),
    });
    const answer = (await res.json().catch(() => ({}))) as RoutesAnswer;
    if (!res.ok) {
      return Response.json(
        { error: answer.error?.message ?? `Google answered ${res.status}.`, fallback: true },
        { status: 502 }
      );
    }
    const ordered = orderFromAnswer(answer, plan);
    if (!ordered) {
      return Response.json(
        { error: "Google found no route through every stop.", fallback: true },
        { status: 502 }
      );
    }
    return Response.json({ ...ordered, source: "google" });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Unexpected error planning the route.";
    return Response.json({ error: message, fallback: true }, { status: 500 });
  }
}
