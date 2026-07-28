import type { SupabaseClient } from "@supabase/supabase-js";
import { findSharedPoints, geocodeState, type GeocodeState } from "./geocode";
import type { Tables } from "./supabase/types";

type StoreRow = Tables<"stores">;

/**
 * The location review queue.
 *
 * A new customer imports a few thousand stores and the geocoder gets most of
 * them roughly right and some of them confidently wrong. Wrong is the expensive
 * kind: the geofence follows the coordinate, so a rep standing in the correct
 * shop is recorded as off-site, and nobody finds out until someone disputes a
 * visit months later. This is the pass that turns "mostly geocoded" into
 * "checked by a person", one store at a time.
 *
 * The ordering is the whole design. Nobody reviews 2,000 stores; they review
 * until they get bored. So the queue must spend that attention on the stores
 * most likely to be wrong, and it must be able to say *why* each one is in the
 * list, or a reviewer has no basis to judge and will just click Confirm.
 */

/** Why a store is in the queue, worst first. */
export type ReviewReason =
  | "collapsed"
  | "shared"
  | "rejected"
  | "missing"
  | "weak_source"
  | "unchecked";

export type ReviewItem = {
  store: StoreRow;
  reason: ReviewReason;
  state: GeocodeState;
  /** Other stores sitting on this exact coordinate. */
  sharedWith: { id: string; name: string }[];
  /** What the geocoder said it matched, when there is one. */
  matched: string | null;
};

export const REVIEW_REASONS: Record<
  ReviewReason,
  { label: string; blurb: string; rank: number }
> = {
  collapsed: {
    label: "Same listing as another store",
    blurb:
      "Google returned the identical listing for this and at least one other branch, so they share one point. At most one of them can be right, and the others are geofenced somewhere they are not.",
    rank: 0,
  },
  shared: {
    label: "Shares a point with another store",
    blurb:
      "Another store sits on this exact coordinate. That is occasionally genuine — two branches in one centre — but it is worth a look.",
    rank: 1,
  },
  rejected: {
    label: "A match was already rejected",
    blurb:
      "Somebody looked at what the geocoder returned and threw it away. The store has had no location since. Looking it up again finds the same wrong shop, so this one needs a pin or a rep.",
    rank: 2,
  },
  missing: {
    label: "No location at all",
    blurb:
      "Nothing has ever been found for this store. Visits here cannot be verified against anything.",
    rank: 3,
  },
  weak_source: {
    label: "Found by address",
    blurb:
      "Matched through an address rather than the shop's name, which is the weakest signal available — an address it cannot parse still returns a confident answer.",
    rank: 4,
  },
  unchecked: {
    label: "Not checked yet",
    blurb:
      "Found by name through Google Places. Usually right, which is exactly why the wrong ones are easy to miss.",
    rank: 5,
  },
};

/**
 * Builds the queue from stores already in memory.
 *
 * Client-side because the page holds every store anyway, and because
 * `findSharedPoints` needs the whole estate to see a collision at all — a
 * server-side LIMIT would hide the very thing being looked for.
 */
export function buildReviewQueue(stores: StoreRow[]): ReviewItem[] {
  const active = stores.filter((s) => s.active);
  const points = findSharedPoints(active);

  // Plain objects rather than Map, matching the Stores page: lucide's `Map`
  // icon shadows the constructor wherever these two are used together.
  const sharedBy: Record<string, { id: string; name: string }[]> = {};
  const collapsed: Record<string, true> = {};
  for (const p of points) {
    for (const s of p.stores) {
      sharedBy[s.id] = p.stores
        .filter((o) => o.id !== s.id)
        .map((o) => ({ id: o.id, name: o.name }));
      if (p.sameResult) collapsed[s.id] = true;
    }
  }

  const items: ReviewItem[] = [];
  for (const store of active) {
    // A confirmation is the point of the queue — once given, the store leaves
    // and no automatic run may put it back.
    if (store.location_confirmed_at) continue;

    const state = geocodeState(store);
    // Captured by a rep standing in the shop. Better evidence than anything a
    // reviewer at a desk can bring, so it is not queued for their opinion.
    if (state === "rep") continue;

    let reason: ReviewReason;
    if (collapsed[store.id]) reason = "collapsed";
    else if (sharedBy[store.id]) reason = "shared";
    else if (state === "rejected") reason = "rejected";
    else if (state === "missing") reason = "missing";
    else if (state === "geocoding") reason = "weak_source";
    else reason = "unchecked";

    items.push({
      store,
      reason,
      state,
      sharedWith: sharedBy[store.id] ?? [],
      matched: store.geocode_result,
    });
  }

  return items.sort((a, b) => {
    const byRank =
      REVIEW_REASONS[a.reason].rank - REVIEW_REASONS[b.reason].rank;
    if (byRank !== 0) return byRank;
    // Stable within a reason, and grouped by town so a reviewer who knows
    // Gaborone can work through Gaborone.
    const byCity = (a.store.city ?? "").localeCompare(b.store.city ?? "");
    if (byCity !== 0) return byCity;
    return a.store.name.localeCompare(b.store.name);
  });
}

/**
 * Problems with the store's own record, as opposed to its coordinate.
 *
 * A checker cannot place a shop they have nothing to go on for. Asking them to
 * confirm a row with no town and no address is asking them to guess, and a
 * guess recorded as a confirmation is worse than leaving it unchecked — it
 * carries a human's name on it and stops anything else looking at it again.
 * So the queue says plainly when the row itself is the problem.
 */
export type DataProblem = { label: string; detail: string };

export function dataProblems(
  store: StoreRow,
  stores: StoreRow[]
): DataProblem[] {
  const problems: DataProblem[] = [];

  if (!store.city) {
    problems.push({
      label: "No town on file",
      detail:
        "Nothing says which town this shop is in, so there is no way to judge whether a point is even in the right part of the country. It is also unschedulable until this is filled in.",
    });
  }
  if (!store.address) {
    problems.push({
      label: "No address",
      detail:
        "No street or plot to match against. If you do not recognise the name, this one is better skipped than guessed at.",
    });
  }

  const sameName = stores.filter(
    (s) =>
      s.id !== store.id &&
      s.active &&
      s.name.trim().toLowerCase() === store.name.trim().toLowerCase()
  );
  if (sameName.length > 0) {
    problems.push({
      label: "Another store has this exact name",
      detail: `${sameName.length} other active store${sameName.length === 1 ? "" : "s"} share this name. Either the import duplicated a row, or two real branches need telling apart before anyone can place them.`,
    });
  }

  // A name that is only a chain with no branch is the shape that geocodes to
  // the chain's generic listing — the failure that put four Liquoramas on one
  // point.
  if (store.name.trim().split(/\s+/).length < 2) {
    problems.push({
      label: "Name is a single word",
      detail:
        "A name with no branch in it matches the chain's generic listing rather than this shop, which is how several branches end up sharing one coordinate.",
    });
  }

  return problems;
}

/**
 * Records that a person is satisfied this store is where the map says.
 *
 * Leaves the coordinate and its source untouched — the confirmation is a
 * separate fact about the same point, and flattening the two would lose which
 * service originally found it.
 */
export async function confirmLocation(
  supabase: SupabaseClient,
  storeId: string,
  profileId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("stores")
    .update({
      location_confirmed_at: new Date().toISOString(),
      location_confirmed_by: profileId,
    })
    .eq("id", storeId)
    .select("id");
  if (error) throw new Error(error.message);
  // A PostgREST update that matches nothing succeeds silently, and a
  // confirmation that did not land would quietly drop the store back into the
  // queue on the next load with no explanation.
  if ((data?.length ?? 0) === 0) {
    throw new Error("That store could not be updated — reload and try again.");
  }
}

/**
 * Moves a store to where the reviewer put the pin, and confirms it in the same
 * write.
 *
 * Placing a pin *is* the confirmation — a person just told us where the shop is,
 * which is a stronger statement than agreeing with a machine. Doing it in one
 * update also means the two facts cannot end up disagreeing if the second write
 * fails.
 *
 * `geocode_result` is cleared: it described a match that has just been
 * overruled, and leaving it would make an automatic run treat this store as
 * "already ruled on and still wrong" rather than "settled".
 */
export async function repositionLocation(
  supabase: SupabaseClient,
  storeId: string,
  lat: number,
  lng: number,
  profileId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("stores")
    .update({
      lat,
      lng,
      geocoded_at: new Date().toISOString(),
      geocode_source: "manual",
      geocode_result: null,
      geocode_accuracy_m: null,
      location_confirmed_at: new Date().toISOString(),
      location_confirmed_by: profileId,
    })
    .eq("id", storeId)
    .select("id");
  if (error) throw new Error(error.message);
  if ((data?.length ?? 0) === 0) {
    throw new Error("That store could not be updated — reload and try again.");
  }
}

/** Where to open the map when a store has no coordinate of its own. */
export const BOTSWANA_CENTRE = { lat: -24.6282, lng: 25.9231 };

/**
 * A sensible starting view for a store with no point: the middle of the other
 * stores in its town, falling back to the estate's own centre.
 *
 * Dropping a reviewer at the centre of the country to find a shop in Maun is a
 * good way to make them give up, and the estate already knows roughly where its
 * towns are.
 */
export function suggestedCentre(
  store: StoreRow,
  stores: StoreRow[]
): { lat: number; lng: number } {
  if (store.lat !== null && store.lng !== null) {
    return { lat: store.lat, lng: store.lng };
  }
  const inTown = stores.filter(
    (s) =>
      s.id !== store.id &&
      s.city !== null &&
      s.city === store.city &&
      s.lat !== null &&
      s.lng !== null &&
      // Only points somebody has vouched for, or a bad match drags the
      // starting view towards the very error being corrected.
      (s.location_confirmed_at !== null || s.geocode_source === "rep")
  );
  const pool = inTown.length > 0
    ? inTown
    : stores.filter(
        (s) => s.city === store.city && s.lat !== null && s.lng !== null
      );
  if (pool.length === 0) return BOTSWANA_CENTRE;
  return {
    lat: pool.reduce((n, s) => n + (s.lat ?? 0), 0) / pool.length,
    lng: pool.reduce((n, s) => n + (s.lng ?? 0), 0) / pool.length,
  };
}
