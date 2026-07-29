import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

/**
 * Turns store addresses into coordinates.
 *
 * Server-side because the Google key must never reach a browser bundle — same
 * reasoning as `OPENAI_API_KEY` in `/api/insights`, and `proxy.ts` excludes
 * /api so this handler authenticates itself.
 *
 * **Places text search first, Geocoding only as a fallback.** Measured against
 * this estate: asked for "Choppies Hyper Game City, Gaborone", the Geocoding
 * API returned a plus code 5.7 km away with `ROOFTOP` precision, because it
 * could not parse "GAME CITY" as a street address and quietly degraded to the
 * middle of the city. Places found the shop by name. These are named retail
 * outlets in known malls, not postal addresses, so name matching is the right
 * instrument.
 *
 * Nothing is written here. The handler proposes; the caller decides. A wrong
 * coordinate is worse than none — it puts the geofence somewhere the rep is
 * not, so a check-in at the correct shop reads as off-site — so a result whose
 * town disagrees with the town we already derived is returned flagged rather
 * than saved.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

type Candidate = {
  storeId: string;
  lat: number | null;
  lng: number | null;
  source: "places" | "geocoding" | null;
  /** The address the service believed it matched. */
  matched: string | null;
  /** The returned address mentions the town we expected. */
  matchesTown: boolean;
  expectedTown: string | null;
  /** Set when nothing usable came back. */
  problem: string | null;
};

/** Loose containment: "Gaborone West" should still satisfy "Gaborone". */
function mentionsTown(address: string, town: string | null): boolean {
  if (!town) return false;
  const a = address.toLowerCase();
  const t = town.toLowerCase();
  if (a.includes(t)) return true;
  // Spelling drifts both ways between the source sheet and Google.
  const loose = t.replace(/[^a-z]/g, "").slice(0, 6);
  return loose.length >= 5 && a.replace(/[^a-z]/g, "").includes(loose);
}

/** Botswana's bounding box, give or take. Catches a result on another continent. */
function inBotswana(lat: number, lng: number): boolean {
  return lat > -27.5 && lat < -17.5 && lng > 19.5 && lng < 29.5;
}

async function viaPlaces(
  key: string,
  query: string
): Promise<{ lat: number; lng: number; matched: string } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("region", "bw");
  url.searchParams.set("key", key);

  const res = await fetch(url);
  const json = (await res.json()) as {
    status: string;
    results?: {
      name?: string;
      formatted_address?: string;
      geometry?: { location?: { lat: number; lng: number } };
    }[];
  };
  const hit = json.results?.[0];
  if (json.status !== "OK" || !hit?.geometry?.location) return null;

  return {
    lat: hit.geometry.location.lat,
    lng: hit.geometry.location.lng,
    matched: [hit.name, hit.formatted_address].filter(Boolean).join(" — "),
  };
}

async function viaGeocoding(
  key: string,
  query: string
): Promise<{ lat: number; lng: number; matched: string } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("region", "bw");
  url.searchParams.set("key", key);

  const res = await fetch(url);
  const json = (await res.json()) as {
    status: string;
    results?: {
      formatted_address?: string;
      geometry?: { location?: { lat: number; lng: number } };
    }[];
  };
  const hit = json.results?.[0];
  if (json.status !== "OK" || !hit?.geometry?.location) return null;

  return {
    lat: hit.geometry.location.lat,
    lng: hit.geometry.location.lng,
    matched: hit.formatted_address ?? "",
  };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if ((profile as { role: string } | null)?.role !== "manager") {
      return Response.json(
        { error: "Geocoding is available to managers only." },
        { status: 403 }
      );
    }

    // After authz: an anonymous caller should learn nothing about the server's
    // configuration, including which keys are set.
    const placesKey = process.env.GOOGLE_PLACES_API_KEY;
    const geoKey = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!placesKey && !geoKey) {
      return Response.json(
        { error: "No Google API key is configured on the server." },
        { status: 503 }
      );
    }

    const body = (await request.json()) as { storeIds?: string[] };
    const storeIds = body.storeIds ?? [];
    if (storeIds.length === 0) {
      return Response.json({ error: "storeIds is required." }, { status: 400 });
    }
    // Bounded so one request cannot run for minutes or burn quota unnoticed.
    if (storeIds.length > 25) {
      return Response.json(
        { error: "Send at most 25 stores per request." },
        { status: 400 }
      );
    }

    // Charged per store, because Google is: 25 stores is 25 lookups, not one
    // request. Consumed before any call goes out, so an expensive batch cannot
    // slip through while the counter is still being written.
    const gate = await enforceRateLimit(supabase, LIMITS.geocode, storeIds.length);
    if (!gate.ok) return gate.response;

    // RLS scopes this to the caller's org, so a store id from elsewhere simply
    // returns nothing rather than being geocoded on someone else's behalf.
    const { data: stores, error } = await supabase
      .from("stores")
      .select("id, name, address, city, state")
      .in("id", storeIds);
    if (error) throw new Error(error.message);

    const candidates: Candidate[] = [];

    for (const s of (stores ?? []) as {
      id: string;
      name: string;
      address: string | null;
      city: string | null;
      state: string | null;
    }[]) {
      // Name first: these are named outlets, and the name is what Places
      // matches on. The town disambiguates the many same-named branches.
      const query = [s.name, s.address, s.city, "Botswana"]
        .filter(Boolean)
        .join(", ");

      let hit = placesKey ? await viaPlaces(placesKey, query) : null;
      let source: "places" | "geocoding" | null = hit ? "places" : null;

      if (!hit && geoKey) {
        hit = await viaGeocoding(geoKey, query);
        source = hit ? "geocoding" : null;
      }

      if (!hit) {
        candidates.push({
          storeId: s.id,
          lat: null,
          lng: null,
          source: null,
          matched: null,
          matchesTown: false,
          expectedTown: s.city,
          problem: "Nothing found",
        });
        continue;
      }

      if (!inBotswana(hit.lat, hit.lng)) {
        candidates.push({
          storeId: s.id,
          lat: hit.lat,
          lng: hit.lng,
          source,
          matched: hit.matched,
          matchesTown: false,
          expectedTown: s.city,
          problem: "Result is outside Botswana",
        });
        continue;
      }

      candidates.push({
        storeId: s.id,
        lat: hit.lat,
        lng: hit.lng,
        source,
        matched: hit.matched,
        matchesTown: mentionsTown(hit.matched, s.city),
        expectedTown: s.city,
        problem: null,
      });
    }

    return Response.json({ candidates });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Unexpected error geocoding.";
    return Response.json({ error: message }, { status: 500 });
  }
}
