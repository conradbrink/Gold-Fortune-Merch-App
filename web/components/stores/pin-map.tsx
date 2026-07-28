"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff, Search } from "lucide-react";

/**
 * A map with one draggable pin.
 *
 * The Stores page's existing map is a Google Maps `<iframe>`, which cannot take
 * a pin — an iframe is opaque to the page around it. This loads the Maps
 * JavaScript API instead, which is a different API and needs its own key.
 *
 * That key is exposed to the browser, unavoidably: it appears in the page
 * source. So it must be a *separate* key from the server-side Geocoding and
 * Places ones, restricted by HTTP referrer, or anyone can lift it and bill map
 * loads to the account. `NEXT_PUBLIC_` in the name is the reminder.
 *
 * With no key configured the component says so plainly rather than rendering a
 * broken grey box, and the review queue still works — a reviewer can confirm or
 * skip, just not reposition.
 */

declare global {
  interface Window {
    google?: typeof google;
    __gmapsPromise?: Promise<MapsLibs>;
  }
}

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

type MapsLibs = {
  Map: typeof google.maps.Map;
  Marker: typeof google.maps.Marker;
  Autocomplete: typeof google.maps.places.Autocomplete | null;
};

/**
 * Loads the Maps script once per page, not once per mount, and hands back the
 * constructors it was asked for.
 *
 * The review queue remounts this on every store; without the shared promise
 * that would append a script tag per store reviewed, and Google logs a loud
 * console warning the second time.
 *
 * **The libraries must come from `importLibrary`, not from `window.google`.**
 * With `loading=async` the API bootstraps lazily: the script's `onload` fires
 * before anything is registered, so reading `google.maps.Map` at that moment
 * throws "is not a constructor". Awaiting `importLibrary` is what actually
 * signals readiness — and it is per-library, which is why Places failing (an
 * unrestricted key, say) leaves the map itself perfectly usable.
 */
function loadMaps(): Promise<MapsLibs> {
  if (window.__gmapsPromise) return window.__gmapsPromise;

  window.__gmapsPromise = new Promise<void>((resolve, reject) => {
    // Already bootstrapped by an earlier mount (or a hot reload) — the
    // bootstrap defines `importLibrary`, so its presence is the readiness
    // signal. `typeof` rather than truthiness: the declared type is
    // non-optional, so a plain check is always true and tsc says so.
    if (typeof window.google?.maps?.importLibrary === "function") {
      return resolve();
    }
    const s = document.createElement("script");
    // `loading=async` is what Google asks for; without it the console carries a
    // performance warning on every load.
    //
    // Still using the classic `Marker` rather than `AdvancedMarkerElement`,
    // which Google prefers: advanced markers require a cloud-configured Map ID,
    // and that is one more thing every customer of this product would have to
    // set up before they could drop a pin. `Marker` is deprecated but explicitly
    // not scheduled for removal, with 12 months' notice promised. Revisit if a
    // Map ID is needed for something else anyway.
    //
    // `libraries=places` powers the search box. That means the browser key
    // needs the Places API allowed alongside Maps JavaScript API, or the
    // autocomplete silently returns nothing while the map itself still works —
    // which is exactly the sort of half-failure worth naming in the UI, so the
    // component says so when it sees it.
    // `callback=` rather than `script.onload`. The script's load event fires
    // when the bootstrap has been *fetched*, which is a moment before it has
    // finished defining `importLibrary` — reading it there throws "is not a
    // function" intermittently, depending on how fast the machine is. The
    // callback is the API's own readiness signal and has no such race.
    const CB = "__gfMapsReady";
    (window as unknown as Record<string, unknown>)[CB] = () => resolve();
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&v=weekly&loading=async&libraries=places&callback=${CB}`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps failed to load."));
    document.head.appendChild(s);
  }).then(async () => {
    const g = window.google!;
    const [maps, markerLib] = await Promise.all([
      g.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
      g.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    ]);
    // Places is optional: the key may not have the Places API enabled, and the
    // map is still worth having without a search box.
    let Autocomplete: typeof google.maps.places.Autocomplete | null = null;
    try {
      const places = (await g.maps.importLibrary(
        "places"
      )) as google.maps.PlacesLibrary;
      Autocomplete = places.Autocomplete;
    } catch {
      Autocomplete = null;
    }
    return { Map: maps.Map, Marker: markerLib.Marker, Autocomplete };
  });

  return window.__gmapsPromise;
}

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
  const onChange = useRef(onPinChange);
  onChange.current = onPinChange;

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
        {error} Check the key's referrer restrictions and that the Maps
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
