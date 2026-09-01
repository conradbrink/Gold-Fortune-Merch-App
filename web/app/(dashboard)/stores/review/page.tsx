"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  MapPin,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GeocodePill } from "@/components/stores/geocode-pill";
import { GeocodeDialog } from "@/components/stores/geocode-dialog";
import { PinMap } from "@/components/stores/pin-map";
import { createClient } from "@/lib/supabase/client";
import { isProtectedFromAutoGeocode, mapsPreview } from "@/lib/geocode";
import {
  buildReviewQueue,
  clusterIsTrustworthy,
  confirmLocation,
  dataProblems,
  repositionLocation,
  suggestedCentre,
  REVIEW_REASONS,
  type DriftSignal,
  type ReviewItem,
} from "@/lib/store-review";
import type { Tables } from "@/lib/supabase/types";

type StoreRow = Tables<"stores">;

/**
 * Check every store's position, one at a time, worst first.
 *
 * Built for the customer who has just imported two thousand stores and needs to
 * know which of them the geocoder got wrong before their reps start being
 * marked off-site for standing in the right shop.
 *
 * It is a page rather than a dialog because it is a sitting, not an
 * interruption: it has a URL to come back to, it survives a reload, and the
 * keyboard shortcuts make a long session bearable.
 */
export default function StoreReviewPage() {
  const supabase = createClient();

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [drift, setDrift] = useState<Record<string, DriftSignal>>({});
  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  /** Where the reviewer has dragged or clicked the pin, before saving. */
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Reviewed in this sitting, so progress is visible without a refetch. */
  const [done, setDone] = useState(0);
  const [geocodeOpen, setGeocodeOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [auth, storeRes, driftRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("stores").select("*").order("name"),
      // Only Postgres can compute this: it needs every check-in in the org.
      supabase.rpc("store_location_drift", {}),
    ]);
    setProfileId(auth.data.user?.id ?? null);
    setStores(storeRes.data ?? []);

    const byStore: Record<string, DriftSignal> = {};
    for (const r of driftRes.data ?? []) {
      byStore[r.store_id] = {
        storeId: r.store_id,
        visits: r.visits_considered,
        reps: r.reps_involved,
        medianOffsetM: r.median_offset_m,
        spreadM: r.spread_m,
        clusterLat: r.cluster_lat,
        clusterLng: r.cluster_lng,
        clusterOffsetM: r.cluster_offset_m,
      };
    }
    setDrift(byStore);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `load` still starts before this returns.
    void (async () => {
      await load();
    })();
  }, [load]);

  const queue = useMemo(() => buildReviewQueue(stores, drift), [stores, drift]);
  const item: ReviewItem | undefined = queue[index];

  /** Stores an automatic lookup may still usefully try.
   *
   * This is the bulk first pass, and it lives here rather than on the Stores
   * page because it is the same job: nobody is pinning two thousand shops by
   * hand, so the machine has a go first and a person judges what it produced.
   * One entry point, in the order the work actually happens.
   *
   * Stores a person already ruled on are excluded — running the same lookup
   * again finds the same wrong shop, which is precisely how 31 rejected matches
   * once got re-applied. */
  const geocodable = useMemo(
    () =>
      stores
        .filter(
          (s) =>
            s.active &&
            (s.lat === null || s.lng === null) &&
            !isProtectedFromAutoGeocode(s)
        )
        .map((s) => ({
          id: s.id,
          name: s.name,
          city: s.city,
          address: s.address,
        })),
    [stores]
  );

  // A fresh store means a fresh pin — otherwise the previous store's dragged
  // position silently carries over and could be saved onto the wrong shop.
  useEffect(() => {
    // Resetting on a change of identity is what this effect is for — see the
    // comment above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(null);
    setError(null);
  }, [item?.store.id]);

  const centre = useMemo(
    () => (item ? suggestedCentre(item.store, stores) : { lat: 0, lng: 0 }),
    [item, stores]
  );

  const problems = useMemo(
    () => (item ? dataProblems(item.store, stores) : []),
    [item, stores]
  );

  const pin = useMemo(() => {
    if (draft) return draft;
    if (item && item.store.lat !== null && item.store.lng !== null) {
      return { lat: item.store.lat, lng: item.store.lng };
    }
    return null;
  }, [draft, item]);

  /** Drops the reviewed store out of the queue without another round trip. */
  function applyLocally(storeId: string, patch: Partial<StoreRow>) {
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, ...patch } : s))
    );
    setDone((n) => n + 1);
    // The store leaves the queue, so everything after it shifts down by one and
    // the index already points at the next store. Nothing to advance.
  }

  async function onConfirm() {
    if (!item || !profileId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmLocation(supabase, item.store.id, profileId);
      applyLocally(item.store.id, {
        location_confirmed_at: new Date().toISOString(),
        location_confirmed_by: profileId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSavePin() {
    if (!item || !profileId || !draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      await repositionLocation(
        supabase,
        item.store.id,
        draft.lat,
        draft.lng,
        profileId
      );
      applyLocally(item.store.id, {
        lat: draft.lat,
        lng: draft.lng,
        geocode_source: "manual",
        geocode_result: null,
        location_confirmed_at: new Date().toISOString(),
        location_confirmed_by: profileId,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Leaves the store in the queue for someone who knows the town better. */
  function onSkip() {
    setIndex((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
  }

  // Skip has a shortcut; confirming does not, and that asymmetry is deliberate.
  //
  // An earlier version bound plain `c` to confirm, and within minutes a stray
  // keystroke — typed at a search box that had lost focus — signed off two
  // stores that share one coordinate, which is precisely the error this page
  // exists to catch. A confirmation puts a person's name against a claim about
  // the real world and stops anything else re-examining the store; it should
  // cost a deliberate click. Skipping costs nothing and changes nothing, so it
  // keeps its key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      // Also ignore anything carrying a modifier — those are browser commands.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "s") onSkip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const remaining = queue.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/stores"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Back to stores"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Location exceptions
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Reps set store locations by standing in them. These are the ones
            that cannot settle themselves — where visits keep landing somewhere
            else, where two shops share one point, or where the record is too
            thin to act on.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {geocodable.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGeocodeOpen(true)}
            >
              Look up {geocodable.length} automatically
            </Button>
          )}
          <div className="text-right text-sm">
            <div className="font-semibold text-foreground">
              {remaining} needing a look
            </div>
            {done > 0 && (
              <div className="text-muted-foreground">{done} settled just now</div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-96 animate-pulse rounded-lg bg-muted/50" />
      ) : !item ? (
        <div className="rounded-lg border border-dashed border-border bg-card py-24 text-center">
          <Check className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
          <p className="font-semibold text-foreground">
            Nothing needs a decision.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {done > 0
              ? `You settled ${done} in this sitting.`
              : "No store is drifting, sharing a point, or missing the details needed to place it. Reps will fill in the rest as they visit."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            nativeButton={false}
            render={<Link href="/stores">Back to stores</Link>}
          />
        </div>
      ) : (
        <>
        {/* Above everything, because it changes whether the question below can
            honestly be answered at all. A checker who cannot tell where the
            shop is meant to be should skip it and fix the record, not guess and
            sign their name to the guess. */}
        {problems.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              This store&apos;s own details don&apos;t add up
            </p>
            <ul className="mt-2 space-y-1.5">
              {problems.map((p) => (
                <li
                  key={p.label}
                  className="text-xs text-red-800/90 dark:text-red-300/90"
                >
                  <span className="font-medium">{p.label}.</span> {p.detail}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-red-800/90 dark:text-red-300/90">
              If you cannot tell which shop this is, skip it and fix the record
              on the Stores page — a confirmation is a claim that someone
              checked, and a guess is worse than leaving it unchecked.
            </p>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <PinMap
            centre={centre}
            pin={pin}
            onPinChange={setDraft}
            resetKey={item.store.id}
            className="h-[420px] w-full lg:h-[560px]"
          />

          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-lg font-semibold text-foreground">
                {item.store.name}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {[item.store.address, item.store.city, item.store.state]
                  .filter(Boolean)
                  .join(", ") || "No address on file"}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <GeocodePill state={item.state} shared={item.sharedWith.length > 0} />
                {pin && (
                  <a
                    href={mapsPreview(pin.lat, pin.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open in Google Maps
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                {REVIEW_REASONS[item.reason].label}
              </p>
              <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90">
                {REVIEW_REASONS[item.reason].blurb}
              </p>
              {item.matched && (
                <p className="mt-2 text-xs text-amber-800/90 dark:text-amber-300/90">
                  Google matched “{item.matched}”.
                </p>
              )}
              {item.sharedWith.length > 0 && (
                <p className="mt-2 text-xs text-amber-800/90 dark:text-amber-300/90">
                  Same point as{" "}
                  {item.sharedWith.map((s) => s.name).join(", ")}.
                </p>
              )}
            </div>

            {item.drift && (
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-sm font-semibold text-foreground">
                  What the visits show
                </p>
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Check-ins measured</dt>
                    <dd className="font-medium">
                      {item.drift.visits} across {item.drift.reps} rep
                      {item.drift.reps === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Typically this far off</dt>
                    <dd className="font-medium">
                      {Math.round(item.drift.medianOffsetM)} m
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      How much they agree
                    </dt>
                    <dd className="font-medium">
                      ± {Math.round(item.drift.spreadM)} m
                    </dd>
                  </div>
                </dl>

                {/* The centroid is only a shopfront when the check-ins agree.
                    Scattered visits average to a point nobody stood on, so the
                    offer is withheld rather than dressed up. */}
                {clusterIsTrustworthy(item.drift) ? (
                  <>
                    <p className="mt-2 text-xs text-muted-foreground">
                      They cluster tightly {Math.round(item.drift.clusterOffsetM)} m
                      from the recorded point, across more than one rep. That
                      reads as the record being wrong rather than the visits.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full"
                      onClick={() =>
                        setDraft({
                          lat: item.drift!.clusterLat,
                          lng: item.drift!.clusterLng,
                        })
                      }
                    >
                      Move the pin to where they check in
                    </Button>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    The check-ins are spread out
                    {item.drift.reps === 1 ? " and all from one rep" : ""}, so
                    they do not agree on a better position. This may be how the
                    store is being visited rather than where it is — worth a
                    word before moving anything.
                  </p>
                )}
              </div>
            )}

            {draft && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">
                <p className="font-semibold">Pin moved</p>
                <p className="mt-0.5 text-xs">
                  {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)} — saving records
                  this as the store&rsquo;s position and marks it checked by you.
                </p>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  Put it back
                </button>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="space-y-2">
              {draft ? (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={onSavePin}
                >
                  <MapPin className="h-4 w-4" />
                  {busy ? "Saving…" : "Save this position"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={busy || pin === null}
                  onClick={onConfirm}
                  title={
                    pin === null
                      ? "There is no position to confirm — drop a pin instead."
                      : undefined
                  }
                >
                  <Check className="h-4 w-4" />
                  {busy ? "Saving…" : "This is correct"}
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={onSkip}
              >
                Skip for now
                <ChevronRight className="h-4 w-4" />
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {pin === null
                  ? "Click the map to place this shop, or search for it above."
                  : "Click or drag the pin to move it."}{" "}
                Press <kbd className="font-mono">s</kbd> to skip.
              </p>
            </div>
          </div>
        </div>
        </>
      )}

      <GeocodeDialog
        open={geocodeOpen}
        onOpenChange={setGeocodeOpen}
        stores={geocodable}
        onDone={load}
      />
    </div>
  );
}
