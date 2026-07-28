"use client";

import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  GEOCODE_BATCH,
  applyCandidates,
  geocodeBatch,
  isConfident,
  mapsPreview,
  type GeocodeCandidate,
  type SharedPoint,
} from "@/lib/geocode";

type Store = { id: string; name: string; city: string | null; address: string | null };

/**
 * Finds coordinates for stores that have none.
 *
 * Confident results — found, inside Botswana, and in the town we already
 * derived — are applied automatically. Everything else is listed for a human,
 * because a coordinate in the wrong place is worse than a missing one: the
 * geofence follows it, so a rep standing in the right shop is recorded as
 * off-site. The town check is what catches that, and it is only possible
 * because the import derived a reliable town for every store.
 */
export function GeocodeDialog({
  open,
  onOpenChange,
  stores,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stores with no coordinates. */
  stores: Store[];
  onDone: () => void;
}) {
  const supabase = createClient();

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [applied, setApplied] = useState(0);
  const [needsReview, setNeedsReview] = useState<GeocodeCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const byId = new Map(stores.map((s) => [s.id, s]));

  async function run() {
    setRunning(true);
    setError(null);
    setDone(0);
    setApplied(0);
    setNeedsReview([]);
    setFinished(false);

    try {
      let appliedTotal = 0;
      const review: GeocodeCandidate[] = [];

      for (let i = 0; i < stores.length; i += GEOCODE_BATCH) {
        const slice = stores.slice(i, i + GEOCODE_BATCH);
        const candidates = await geocodeBatch(slice.map((s) => s.id));

        const confident = candidates.filter(isConfident);
        review.push(...candidates.filter((c) => !isConfident(c)));

        if (confident.length > 0) {
          appliedTotal += await applyCandidates(supabase, confident);
        }

        setDone(Math.min(i + GEOCODE_BATCH, stores.length));
        setApplied(appliedTotal);
        setNeedsReview([...review]);
      }
      setFinished(true);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  /** Accepts one flagged result after the manager has looked at the map. */
  async function acceptOne(c: GeocodeCandidate) {
    setError(null);
    try {
      await applyCandidates(supabase, [c]);
      setNeedsReview((prev) => prev.filter((x) => x.storeId !== c.storeId));
      setApplied((n) => n + 1);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Find store locations</DialogTitle>
          <DialogDescription>
            Looks each store up by name and town. Results in the expected town
            are saved; anything else is listed for you to check.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {!running && !finished && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              {stores.length} store{stores.length === 1 ? "" : "s"} have no
              location yet. Without one they cannot geofence, and check-in
              distance reads as unknown.
            </p>
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Stores are matched by name first — these are named outlets in
              known malls, which Google finds far more reliably than a plot
              number. A result that lands in a different town from the one on
              record is never saved automatically.
            </p>
          </div>
        )}

        {(running || finished) && (
          <div className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${stores.length ? (done / stores.length) * 100 : 0}%` }}
              />
            </div>
            <p className="text-sm text-foreground">
              {running ? `Looking up ${done} of ${stores.length}…` : "Finished."}{" "}
              <span className="font-semibold text-emerald-700 dark:text-emerald-500">
                {applied} saved
              </span>
              {needsReview.length > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-amber-700 dark:text-amber-500">
                    {needsReview.length} need{needsReview.length === 1 ? "s" : ""} a look
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {needsReview.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Not saved — check these
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {needsReview.map((c) => {
                const store = byId.get(c.storeId);
                return (
                  <li key={c.storeId} className="space-y-1.5 px-3 py-2.5">
                    <p className="text-sm font-medium text-foreground">
                      {store?.name ?? "Unknown store"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expected {c.expectedTown ?? "no town"} ·{" "}
                      {c.problem
                        ? c.problem
                        : `Google said “${c.matched}”`}
                    </p>
                    {c.lat !== null && c.lng !== null && (
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={mapsPreview(c.lat, c.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          See it on the map
                        </a>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => acceptOne(c)}
                        >
                          <Check className="h-3 w-3" />
                          It&rsquo;s right — save it
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              Leaving one unsaved is fine. It keeps no location, which is
              honest, rather than a wrong one that would misreport every visit.
            </p>
          </div>
        )}

        <DialogFooter>
          {!finished && (
            <Button onClick={run} disabled={running || stores.length === 0}>
              {running ? `Working…` : `Find ${stores.length} location${stores.length === 1 ? "" : "s"}`}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
            {finished ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Stores that share a coordinate with another store.
 *
 * Separate from the missing-location banner because it is a different and
 * quieter failure: these stores *look* located. A geocoder that cannot find a
 * specific branch often returns the chain's generic listing, which sits in the
 * right town and so survives the town cross-check, while being the same point
 * it returns for every other branch.
 */
export function SharedPointBanner({
  points,
  onClear,
}: {
  points: SharedPoint[];
  onClear: (storeIds: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (points.length === 0) return null;

  // Pairs are often genuine — two numbered branches in one shopping centre.
  // Three or more differently-named branches on one point is not.
  const suspect = points.filter((p) => p.stores.length >= 3);
  const affected = points.reduce((n, p) => n + p.stores.length, 0);

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
      <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">{affected}</span> stores share a
          location with another store, across {points.length} point
          {points.length === 1 ? "" : "s"}. A shared point geofences all of them
          in the same place, so only one can be right.
        </span>
      </p>
      <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
        {points.slice(0, 4).map((p) => (
          <li key={`${p.lat},${p.lng}`} className="truncate">
            <a
              href={mapsPreview(p.lat, p.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {p.stores.length} stores
            </a>
            {": "}
            {p.stores.map((s) => s.name).join(", ")}
          </li>
        ))}
        {points.length > 4 && <li>…and {points.length - 4} more.</li>}
      </ul>
      {suspect.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onClear(suspect.flatMap((p) => p.stores.map((s) => s.id)));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Clearing…"
            : `Clear the ${suspect.reduce((n, p) => n + p.stores.length, 0)} in groups of 3+`}
        </Button>
      )}
    </div>
  );
}

/** Prompt on the Stores page when coordinates are missing. */
export function GeocodeBanner({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
      <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-semibold">{count}</span> store
          {count === 1 ? " has" : "s have"} no location, so{" "}
          {count === 1 ? "it cannot" : "they cannot"} geofence and check-in
          distance reads as unknown.
        </span>
      </p>
      <Button size="sm" variant="outline" onClick={onClick}>
        Find locations
      </Button>
    </div>
  );
}
