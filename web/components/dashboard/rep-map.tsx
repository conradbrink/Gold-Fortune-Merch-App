"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPinOff, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { loadMaps, MAPS_KEY } from "@/lib/google-maps";
import {
  describeAge,
  describeSource,
  freshnessOf,
  minutesSince,
  type LiveReps,
  type RepPosition,
} from "@/lib/live-reps";

/**
 * Where the team is, refreshed while the page is open.
 *
 * The phones sample every five minutes on a platform location stream, and this
 * re-reads every sixty seconds, so a dot is normally minutes old rather than
 * hours. **The age is still given the same weight as the position**, because a
 * five-minute cadence is a promise the phone makes and not one the network
 * keeps: a rep in a dead spot queues fixes in an outbox and they land in a burst
 * later. A dot with no age beside it would claim a certainty that does not
 * exist.
 *
 * ⚠️ Until the app build carrying time-based sampling reaches the handsets, most
 * fixes still come from check-in and check-out, and a rep between two shops can
 * go a long time without one. The colours are what make that legible rather than
 * misleading — green inside twenty minutes, amber inside ninety, grey beyond —
 * and they keep working unchanged as the pings get denser.
 */

const TONE: Record<
  ReturnType<typeof freshnessOf>,
  { dot: string; text: string; pin: string }
> = {
  fresh: {
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-500",
    pin: "#10b981",
  },
  recent: {
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-500",
    pin: "#f59e0b",
  },
  stale: {
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    pin: "#9ca3af",
  },
};

function RepRow({
  position,
  now,
  selected,
  onSelect,
}: {
  position: RepPosition;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const minutes = minutesSince(position.recordedAt, now);
  const tone = TONE[freshnessOf(minutes)];

  return (
    <button
      type="button"
      onClick={onSelect}
      // The row is a toggle, and the only thing distinguishing the chosen one is
      // a background colour — which is nothing at all to a screen reader.
      aria-pressed={selected}
      className={[
        "flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left last:border-b-0",
        selected ? "bg-accent/70" : "hover:bg-accent/40",
      ].join(" ")}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {position.repName}
          </span>
          <span className={`shrink-0 text-xs tabular-nums ${tone.text}`}>
            {describeAge(minutes)}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {describeSource(position.source, position.storeName)}
          {/* "Day open" is the difference between a rep who has gone quiet and
              one who has finished and gone home — the same silence, opposite
              meanings. */}
          {!position.dayOpen && " · day ended"}
        </span>
      </span>
    </button>
  );
}

export function RepMap({ data }: { data: LiveReps }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const fitted = useRef(false);
  /** So clearing a selection re-fits, while an ordinary poll does not. */
  const wasSelected = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);
  /**
   * Bumped by "Try again", and a dependency of the map effect.
   *
   * Clearing the error alone could never work: the effect depends on
   * `[positions, selected]`, neither of which the button changes, so it never
   * re-ran and the container remounted empty and stayed empty. The loader
   * caching its own rejection made it doubly impossible — both halves are fixed.
   */
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  // Ages have to move on their own, or a card left open all afternoon keeps
  // insisting a two-hour-old reading is eighteen minutes old.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const positions = data.positions;
  const chosen = useMemo(
    () => positions.find((p) => p.repId === selected) ?? null,
    [positions, selected]
  );

  // One effect owns the map: create it, draw the markers, then set the view.
  //
  // The view used to live in its own effect reading `mapObj.current`, which is
  // populated inside this `.then()` — so selecting a rep before the map had
  // finished loading found a null map, returned early, and never applied. The
  // click looked like it did nothing. Anything that needs the map to exist
  // belongs where it is known to.
  //
  // `now` is deliberately not a dependency. It ticks every thirty seconds to age
  // the text, and rebuilding every marker on that tick made the map flicker for
  // no gain — colours are recomputed on each poll instead, which is the rate the
  // underlying data can actually change at.
  useEffect(() => {
    // Nothing to draw: the container is unmounted by the render below, so a
    // retained map object would be bound to a node that no longer exists — and
    // when a ping restores the list, the effect would reuse it and the panel
    // would stay blank. Drop it and let the next run build a fresh one.
    if (positions.length === 0) {
      for (const m of markers.current) m.setMap(null);
      markers.current = [];
      mapObj.current = null;
      fitted.current = false;
      return;
    }
    if (!MAPS_KEY || !mapRef.current) return;
    let cancelled = false;

    loadMaps()
      .then(({ Map, Marker }) => {
        if (cancelled || !mapRef.current) return;

        if (!mapObj.current) {
          mapObj.current = new Map(mapRef.current, {
            center: { lat: positions[0].lat, lng: positions[0].lng },
            zoom: 11,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        }

        for (const m of markers.current) m.setMap(null);
        markers.current = [];

        const bounds = new google.maps.LatLngBounds();
        for (const p of positions) {
          const tone = TONE[freshnessOf(minutesSince(p.recordedAt, now))];
          const marker = new Marker({
            position: { lat: p.lat, lng: p.lng },
            map: mapObj.current,
            title: `${p.repName} — ${describeAge(minutesSince(p.recordedAt, now))}`,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: tone.pin,
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              // Push the name clear of the dot. Centred — the default — prints
              // it straight through the marker and neither is then readable.
              labelOrigin: new google.maps.Point(0, 2.6),
            },
            // The name on the pin, because a coloured dot alone does not say who
            // it is — and at a zoom wide enough to hold Maun and Gaborone the two
            // Gaborone reps land on top of each other.
            label: {
              text: p.repName.split(" ")[0],
              color: "#374151",
              fontSize: "11px",
              fontWeight: "600",
            },
          });
          marker.addListener("click", () => setSelected(p.repId));
          markers.current.push(marker);
          bounds.extend({ lat: p.lat, lng: p.lng });
        }

        const pick = positions.find((p) => p.repId === selected) ?? null;
        if (pick) {
          // Go *to* them. Merely centring keeps the fit-everyone zoom, which is
          // wide enough to hold Maun and Gaborone — 575 km apart — so Gaborone
          // and Tlokweng are the same pixel and the click appears to do nothing.
          //
          // A small box rather than `setZoom`: fitting lets the API choose a
          // level it can actually draw, and a hard zoom of 15 rendered an empty
          // grey panel here. Roughly 400 m either side, which frames a shop and
          // its street without implying this position is accurate to the metre.
          const SPAN = 0.004;
          const around = new google.maps.LatLngBounds(
            { lat: pick.lat - SPAN, lng: pick.lng - SPAN },
            { lat: pick.lat + SPAN, lng: pick.lng + SPAN }
          );
          mapObj.current.fitBounds(around, 24);
        } else if (!fitted.current || wasSelected.current) {
          // Fit on the first build, and again when a selection is cleared.
          // Re-fitting on every poll would drag the view back to the whole
          // country each minute while somebody is reading one rep.
          fitted.current = true;
          if (positions.length > 1) {
            mapObj.current.fitBounds(bounds, 48);
          } else {
            // One rep would otherwise zoom to street level on a single point,
            // which looks like precision this data does not have.
            mapObj.current.setCenter({ lat: positions[0].lat, lng: positions[0].lng });
            mapObj.current.setZoom(12);
          }
        }
        wasSelected.current = pick !== null;
      })
      .catch((e: unknown) =>
        setMapError(e instanceof Error ? e.message : "The map failed to load.")
      );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, selected, retry]);

  const anyOpenDay =
    positions.some((p) => p.dayOpen) || data.missing.some((m) => m.dayOpen);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Where the team is</CardTitle>
        {/* Two claims, and only one of them is true today. The refresh is ours
            and happens now; the five-minute cadence needs an app build that has
            not reached the handsets, so it is stated as a destination rather
            than a fact. */}
        <span className="text-xs text-muted-foreground">
          Latest position · refreshed every minute
        </span>
      </CardHeader>
      <CardContent>
        {positions.length === 0 && data.missing.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No active reps.
          </p>
        ) : positions.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No phone has sent a position in the last 24 hours.
            {anyOpenDay
              ? " Somebody has a workday open, so this is a reporting gap rather than a quiet day."
              : " Nobody has an open workday."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
            <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border">
              {chosen && (
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="w-full border-b border-border bg-muted/40 px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Show everyone
                </button>
              )}
              {positions.map((p) => (
                <RepRow
                  key={p.repId}
                  position={p}
                  now={now}
                  selected={selected === p.repId}
                  onSelect={() =>
                    setSelected((s) => (s === p.repId ? null : p.repId))
                  }
                />
              ))}
              {/* Named, not omitted. "No signal from Atang all day" is the most
                  useful thing this card can say, and dropping those reps would
                  make the board look complete when it is not. */}
              {data.missing.map((m) => (
                <div
                  key={m.repId}
                  className="flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0"
                >
                  <MapPinOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-muted-foreground">
                      {m.repName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {m.dayOpen
                        ? "Workday open, no position sent"
                        : "No position in 24 hours"}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {!MAPS_KEY ? (
              <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground">
                No map key is configured, so the positions are listed but not
                drawn. Set NEXT_PUBLIC_GOOGLE_MAPS_KEY to show the map.
              </div>
            ) : mapError ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-6 text-center text-sm text-destructive">
                {mapError}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setMapError(null);
                    // The map object is gone with the unmounted container, so a
                    // retry has to build a new one rather than reuse the old ref.
                    mapObj.current = null;
                    markers.current = [];
                    fitted.current = false;
                    setRetry((n) => n + 1);
                  }}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            ) : (
              <div
                ref={mapRef}
                className="min-h-[240px] rounded-lg border border-border lg:min-h-[320px]"
              />
            )}
          </div>
        )}

        {/* Said plainly, once, at the bottom. The gap is real until the location
            build ships, and a card that hid it would be quietly wrong for weeks. */}
        {positions.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Green is a fix within 20 minutes, amber within 90, grey older than
            that. A rep with no signal queues positions on the phone and they
            arrive together later, so an age is what a phone last managed to
            send — not proof of where somebody is now.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
