"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff, Search } from "lucide-react";
import { loadMaps, MAPS_KEY as KEY } from "@/lib/google-maps";

/**
 * A map with one draggable pin.
 *
 * The Stores page's existing map is a Google Maps `<iframe>`, which cannot take
 * a pin — an iframe is opaque to the page around it. This loads the Maps
 * JavaScript API instead, which is a different API and needs its own key.
 *
 * The script loading lives in `lib/google-maps.ts`, shared with the dashboard's
 * rep map — including the key rules and the two races the comments there
 * describe. It was lifted out of this file when the second map arrived rather
 * than copied, because a copy would have to earn those comments again.
 *
 * With no key configured the component says so plainly rather than rendering a
 * broken grey box, and the review queue still works — a reviewer can confirm or
 * skip, just not reposition.
 */

export function PinMap({
  centre,
  pin,
  onPinChange,
  resetKey,
  className,
}: {
  /** Where to open when there is no pin yet. */
  centre: { lat: number; lng: number };
  /** The store's current point, or null when it has none. */
  pin: { lat: number; lng: number } | null;
  onPinChange: (p: { lat: number; lng: number }) => void;
  /** Changes when the subject changes — clears the search box. Leaving the
      previous shop's query in place is how somebody ends up searching for the
      wrong building and not noticing. */
  resetKey?: string;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const markerCtor = useRef<typeof google.maps.Marker | null>(null);
  const autocomplete = useRef<google.maps.places.Autocomplete | null>(null);
  // Held in a ref so the map's click handler, which is bound once, always calls
  // the current callback rather than the one from its first render.
  //
  // Assigned from an effect rather than during render: a ref write during
  // render is not allowed, and the commit lands long before any click can
  // arrive — the handler is bound after the map has loaded.
  const onChange = useRef(onPinChange);
  useEffect(() => {
    onChange.current = onPinChange;
  }, [onPinChange]);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (search.current) search.current.value = "";
  }, [resetKey]);

  useEffect(() => {
    if (!KEY) return;
    let cancelled = false;

    loadMaps()
      .then((libs) => {
        if (cancelled || !holder.current) return;
        markerCtor.current = libs.Marker;
        map.current = new libs.Map(holder.current, {
          center: pin ?? centre,
          // Close enough to tell one shopfront from the next, which is the
          // whole job here.
          zoom: pin ? 18 : 13,
          mapTypeId: "hybrid",
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: true,
        });

        map.current.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          onChange.current({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });

        // Search by name, so a reviewer can navigate by a landmark they know —
        // "Riverwalk", "Game City" — instead of hunting across satellite
        // imagery for a shopfront. Selecting a result moves the pin there,
        // which is only a draft: nothing is written until Save.
        if (search.current && libs.Autocomplete) {
          const auto = new libs.Autocomplete(search.current, {
            fields: ["geometry", "name"],
          });
          autocomplete.current = auto;
          auto.addListener("place_changed", () => {
            const place = auto.getPlace();
            const loc = place.geometry?.location;
            if (!loc) return;
            onChange.current({ lat: loc.lat(), lng: loc.lng() });
          });
        }

        setReady(true);
      })
      .catch((e) => !cancelled && setError(e.message));

    return () => {
      cancelled = true;
    };
    // Deliberately mount-only: re-centring on prop change is handled below, and
    // rebuilding the map per store would throw away the reviewer's zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the view and the pin as the queue advances.
  useEffect(() => {
    if (!ready || !map.current || !markerCtor.current) return;
    const target = pin ?? centre;
    map.current.setCenter(target);
    map.current.setZoom(pin ? 18 : 13);

    if (!pin) {
      marker.current?.setMap(null);
      marker.current = null;
      return;
    }
    // Bias the search to a generous box around the store's town rather than to
    // the map's live bounds. Bound to the viewport, a map zoomed to 18 gives
    // Google a box about a hundred metres across, and it will then answer
    // "Riverwalk Gaborone" with the nearest chicken shop in Francistown. Half a
    // degree — roughly 55 km — ranks the right town first while still letting
    // an explicit query reach across the country.
    const bias = 0.5;
    autocomplete.current?.setBounds({
      north: target.lat + bias,
      south: target.lat - bias,
      east: target.lng + bias,
      west: target.lng - bias,
    });

    if (!marker.current) {
      marker.current = new markerCtor.current({
        map: map.current,
        draggable: true,
      });
      marker.current.addListener("dragend", () => {
        const p = marker.current?.getPosition();
        if (p) onChange.current({ lat: p.lat(), lng: p.lng() });
      });
    }
    marker.current.setPosition(pin);
  }, [pin, centre, ready]);

  if (!KEY) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card p-6 text-center ${className ?? ""}`}
      >
        <MapPinOff className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          The map needs a browser key
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Add <code className="font-mono">NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> to{" "}
          <code className="font-mono">web/.env.local</code> and restart the dev
          server. It must be its own key with the Maps JavaScript API enabled and
          an HTTP-referrer restriction — a browser key is visible to anyone who
          views the page.
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          You can still confirm and skip without it; only dropping a pin needs
          the map.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center text-sm text-destructive ${className ?? ""}`}
      >
        {error} Check the key&rsquo;s referrer restrictions and that the Maps
        JavaScript API is enabled.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={search}
          type="text"
          placeholder="Search a mall, landmark or area to jump there…"
          aria-label="Search for a place on the map"
          className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          // Enter would otherwise submit or scroll before the autocomplete has
          // resolved the highlighted suggestion.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
      </div>
      <div ref={holder} className={`rounded-lg ${className ?? ""}`} />
    </div>
  );
}
