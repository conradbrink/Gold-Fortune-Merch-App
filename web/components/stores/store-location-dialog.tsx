"use client";

import { ExternalLink, MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { geocodeState, mapsPreview, type SharedPointStore } from "@/lib/geocode";
import type { Tables } from "@/lib/supabase/types";
import { GeocodePill } from "./geocode-pill";

type StoreRow = Tables<"stores">;

/** The rep and visit behind a field-captured location, from `store_geocode_capture`. */
export type GeocodeCapture = {
  visitId: string;
  repName: string | null;
  checkinAt: string | null;
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Everything known about where one store's coordinates came from.
 *
 * **Every row below is selected by `state`, never by whether a field happens to
 * be set.** Clearing a coordinate leaves `geocoded_at`, `geocode_result`,
 * `geocode_accuracy_m` and `geocode_visit_id` behind on purpose, so a dialog
 * that renders "Located on {geocoded_at}" whenever it is present would tell a
 * manager a store has a location when it has none. The date on a rejected store
 * is the date of the *attempt*, and it is labelled as such.
 *
 * Presentational only: the capture map is already loaded once by the page, so
 * this fetches nothing.
 */
export function StoreLocationDialog({
  store,
  capture,
  sharedWith,
  sameResult,
  onClose,
}: {
  store: StoreRow | null;
  capture: GeocodeCapture | null;
  sharedWith: SharedPointStore[];
  sameResult: boolean;
  onClose: () => void;
}) {
  const state = store ? geocodeState(store) : "missing";
  const located = store?.lat !== null && store?.lng !== null;

  return (
    <Dialog open={store !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{store?.name ?? "Store location"}</DialogTitle>
        </DialogHeader>

        {store && (
          <>
            <div className="-mt-2 flex flex-wrap items-center gap-2">
              <GeocodePill
                state={state}
                accuracyM={store.geocode_accuracy_m}
                shared={sharedWith.length > 0}
              />
              {store.city && (
                <span className="text-sm text-muted-foreground">
                  {store.city}
                </span>
              )}
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Where this came from</span>
              </div>

              {located ? (
                <dl className="space-y-1.5 text-sm">
                  <Row label="Coordinates">
                    <a
                      href={mapsPreview(store.lat!, store.lng!)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {store.lat!.toFixed(5)}, {store.lng!.toFixed(5)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Row>
                  {store.geocoded_at && (
                    <Row label="Located on">
                      {formatWhen(store.geocoded_at)}
                    </Row>
                  )}
                  {state === "rep" && (
                    <>
                      {store.geocode_accuracy_m !== null && (
                        <Row label="GPS accuracy">
                          ± {Math.round(store.geocode_accuracy_m)} m
                        </Row>
                      )}
                      <Row label="Captured by">
                        {capture?.repName ?? "Unknown rep"}
                      </Row>
                    </>
                  )}
                  {/* A rep capture stores no matched text by design — there was
                      no service to match anything. */}
                  {state !== "rep" && state !== "unsourced" && store.geocode_result && (
                    <Row label="Google matched">
                      <span className="text-right">“{store.geocode_result}”</span>
                    </Row>
                  )}
                </dl>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    This store has no location, so nothing can be measured
                    against it — a check-in here records a distance of unknown.
                  </p>
                  {state === "rejected" && (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="mb-1.5 text-sm font-semibold text-foreground">
                        The match that was removed
                      </p>
                      <dl className="space-y-1.5 text-sm">
                        {store.geocode_result && (
                          <Row label="Google answered">
                            <span className="text-right">
                              “{store.geocode_result}”
                            </span>
                          </Row>
                        )}
                        {store.geocoded_at && (
                          <Row label="Last attempted">
                            {formatWhen(store.geocoded_at)}
                          </Row>
                        )}
                      </dl>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Kept on record so the same wrong answer is not accepted a
                        second time. A rep can set the real position from inside
                        the shop on their next visit.
                      </p>
                    </div>
                  )}
                  {state === "missing" && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No lookup has been run for this store yet. Use “Find
                      locations” above the list, or let a rep set it from inside
                      the shop.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* The FK is `on delete set null`, so a capture can genuinely go
                missing. Say so rather than leaving a blank where a name was. */}
            {state === "rep" && capture === null && (
              <p className="text-sm text-muted-foreground">
                The visit this was captured during has since been removed, so the
                rep who set it can no longer be named.
              </p>
            )}
            {state === "rep" && capture?.checkinAt && (
              <p className="text-sm text-muted-foreground">
                Captured during a visit that began {formatWhen(capture.checkinAt)}.
              </p>
            )}
            {state !== "rep" && capture !== null && (
              <p className="text-sm text-muted-foreground">
                A rep placed a location here during a visit
                {capture.checkinAt ? ` on ${formatWhen(capture.checkinAt)}` : ""};
                it has since been replaced or removed.
              </p>
            )}

            {sharedWith.length > 0 && (
              <section>
                <h3 className="mb-1 text-sm font-semibold text-foreground">
                  {sharedWith.length === 1
                    ? "Another store sits on this exact point"
                    : `${sharedWith.length} other stores sit on this exact point`}
                </h3>
                <p className="mb-2 text-sm text-muted-foreground">
                  {sameResult
                    ? "Google returned the same listing for all of them, so at most one is in the right place. A rep standing in any one of these shops is inside every one of their geofences."
                    : "They matched different listings that happen to land on the same point. That can be genuine — two branches in one shopping centre — but it is worth an eye."}
                </p>
                <ul className="space-y-1.5">
                  {sharedWith.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2.5 py-1.5 text-sm"
                    >
                      <span>
                        {s.name}
                        {s.city && (
                          <span className="text-muted-foreground"> · {s.city}</span>
                        )}
                      </span>
                      <GeocodePill
                        state={geocodeState({
                          lat: store.lat,
                          lng: store.lng,
                          geocode_source: s.source,
                          geocode_result: s.result,
                        })}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
