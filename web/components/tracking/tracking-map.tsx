"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadMaps, MAPS_KEY, mapTypeSwitch, rememberMapType } from "@/lib/google-maps";
import { useSitesView } from "@/lib/map-centre";

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label?: string;
  title: string;
  /** Squares for shops and orders, circles for people — legible at a glance. */
  shape?: "circle" | "square";
  onClick?: () => void;
};

/**
 * The map behind the Tracking pages: pins, an optional trail, and a way to
 * look at everything or at one thing.
 *
 * Follows `components/dashboard/rep-map.tsx` on the points that cost bugs
 * there: the Maps API comes from the shared loader, focusing on one pin fits a
 * small box rather than forcing a zoom level (a hard zoom rendered an empty
 * grey panel), a single pin is not zoomed to street level, and ordinary
 * re-renders do not drag the view back to the whole country — only `fitKey`
 * changing does.
 */
export function TrackingMap({
  pins,
  path,
  focus,
  fitKey,
  className = "h-full min-h-[24rem] w-full",
}: {
  pins: MapPin[];
  /** A trail drawn as a line, oldest first. */
  path?: { lat: number; lng: number }[];
  /** Zoom to this point (a selected rep, a chosen shop). */
  focus?: { lat: number; lng: number } | null;
  /** Change it to re-fit everything: a new day, the "Fit all" button. */
  fitKey: string | number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const line = useRef<google.maps.Polyline | null>(null);
  const lastFit = useRef<string | number | null>(null);
  /** The focus last zoomed to, so a minute's refresh does not undo the reader's panning. */
  const lastFocus = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // Read before the map is made, so it opens on the company's own sites
  // rather than opening somewhere else and jumping.
  const opening = useSitesView();

  useEffect(() => {
    if (!MAPS_KEY || !ref.current || !opening) return;
    let cancelled = false;
    loadMaps()
      .then(({ Map, Marker }) => {
        if (cancelled || !ref.current) return;
        // The company's own sites until there is something to fit
        // (lib/map-centre.ts).
        if (!map.current) {
          map.current = new Map(ref.current, {
            center: opening.center,
            zoom: opening.zoom,
            ...mapTypeSwitch(),
            streetViewControl: false,
            fullscreenControl: false,
          });
          rememberMapType(map.current);
        }
        for (const m of markers.current) m.setMap(null);
        markers.current = [];
        line.current?.setMap(null);
        line.current = null;

        const bounds = new google.maps.LatLngBounds();
        for (const p of pins) {
          const marker = new Marker({
            position: { lat: p.lat, lng: p.lng },
            map: map.current,
            title: p.title,
            icon:
              p.shape === "square"
                ? {
                    path: "M -6 -6 L 6 -6 L 6 6 L -6 6 Z",
                    scale: 1,
                    fillColor: p.color,
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                    labelOrigin: new google.maps.Point(0, 18),
                  }
                : {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: p.color,
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                    labelOrigin: new google.maps.Point(0, 2.6),
                  },
            label: p.label
              ? { text: p.label, color: "#374151", fontSize: "11px", fontWeight: "600" }
              : undefined,
          });
          if (p.onClick) marker.addListener("click", p.onClick);
          markers.current.push(marker);
          bounds.extend({ lat: p.lat, lng: p.lng });
        }
        if (path && path.length > 1) {
          line.current = new google.maps.Polyline({
            path,
            map: map.current,
            strokeColor: "#1e3a8a",
            strokeOpacity: 0.75,
            strokeWeight: 3,
          });
          for (const pt of path) bounds.extend(pt);
        }

        const focusKey = focus ? `${focus.lat},${focus.lng}` : null;
        if (!focusKey) lastFocus.current = null;
        if (focus && lastFocus.current !== focusKey) {
          lastFocus.current = focusKey;
          const SPAN = 0.004;
          map.current.fitBounds(
            new google.maps.LatLngBounds(
              { lat: focus.lat - SPAN, lng: focus.lng - SPAN },
              { lat: focus.lat + SPAN, lng: focus.lng + SPAN }
            ),
            24
          );
        } else if (!focus && lastFit.current !== fitKey && !bounds.isEmpty()) {
          lastFit.current = fitKey;
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();
          if (ne.equals(sw)) {
            map.current.setCenter(ne);
            map.current.setZoom(13);
          } else {
            map.current.fitBounds(bounds, 48);
          }
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "The map failed to load."));
    return () => {
      cancelled = true;
    };
  }, [pins, path, focus, fitKey, retry, opening]);

  if (!MAPS_KEY) {
    return (
      <div className={`${className} flex items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground`}>
        <MapPinOff className="mr-2 h-4 w-4" /> No Google Maps key is configured.
      </div>
    );
  }
  if (error) {
    return (
      <div className={`${className} flex flex-col items-center justify-center gap-2 rounded-xl bg-muted text-sm text-muted-foreground`}>
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={() => { setError(null); map.current = null; setRetry((n) => n + 1); }}>
          Try again
        </Button>
      </div>
    );
  }
  return <div ref={ref} className={`${className} rounded-xl`} />;
}
