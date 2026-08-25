/**
 * Loads the Google Maps JavaScript API once per page.
 *
 * Lifted out of `components/stores/pin-map.tsx` when a second map arrived. Every
 * comment below was earned by a bug in that component, and the reason this is
 * shared rather than copied is that a second copy would have to earn them again.
 *
 * The key is exposed to the browser, unavoidably — it appears in the page
 * source. So it must be a **separate** key from the server-side Geocoding and
 * Places ones, restricted by HTTP referrer, or anyone can lift it and bill map
 * loads to the account. `NEXT_PUBLIC_` in the name is the reminder.
 */

declare global {
  interface Window {
    google?: typeof google;
    __gmapsPromise?: Promise<MapsLibs>;
  }
}

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

export type MapsLibs = {
  Map: typeof google.maps.Map;
  Marker: typeof google.maps.Marker;
  /** Null when the key lacks the Places API. The map still works without it. */
  Autocomplete: typeof google.maps.places.Autocomplete | null;
};

/**
 * One script tag per page, not per mount, and the constructors it was asked for.
 *
 * The store review queue remounts its map on every store; without the shared
 * promise that appends a script tag per store reviewed, and Google logs a loud
 * console warning the second time.
 *
 * **The libraries must come from `importLibrary`, not from `window.google`.**
 * With `loading=async` the API bootstraps lazily: the script's load event fires
 * before anything is registered, so reading `google.maps.Map` at that moment
 * throws "is not a constructor". Awaiting `importLibrary` is what actually
 * signals readiness — and it is per-library, which is why Places failing leaves
 * the map itself perfectly usable.
 */
export function loadMaps(): Promise<MapsLibs> {
  if (window.__gmapsPromise) return window.__gmapsPromise;

  window.__gmapsPromise = new Promise<void>((resolve, reject) => {
    // Already bootstrapped by an earlier mount (or a hot reload) — the bootstrap
    // defines `importLibrary`, so its presence is the readiness signal. `typeof`
    // rather than truthiness: the declared type is non-optional, so a plain
    // check is always true and tsc says so.
    if (typeof window.google?.maps?.importLibrary === "function") {
      return resolve();
    }
    const s = document.createElement("script");
    // `callback=` rather than `script.onload`. The load event fires when the
    // bootstrap has been *fetched*, a moment before it has finished defining
    // `importLibrary` — reading it there throws "is not a function"
    // intermittently, depending on how fast the machine is. The callback is the
    // API's own readiness signal and has no such race.
    const CB = "__gfMapsReady";
    (window as unknown as Record<string, unknown>)[CB] = () => resolve();
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly&loading=async&libraries=places&callback=${CB}`;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps failed to load."));
    document.head.appendChild(s);
  }).then(async () => {
    const g = window.google!;
    const [maps, markerLib] = await Promise.all([
      g.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
      g.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    ]);
    // Places is optional: the key may not have that API enabled, and a map
    // without a search box is still worth having.
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
