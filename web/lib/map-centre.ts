"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Where a map opens before it has anything of its own to fit: the middle of
 * the company's located sites. It used to be Gaborone, which is right for one
 * company and the wrong continent for the next; a map of the Atlantic at 0,0
 * reads as broken, so a company with no located sites yet gets a wide view of
 * the world instead.
 */

export type MapView = { center: { lat: number; lng: number }; zoom: number };

/** No located sites yet: the whole world, centred on the land rather than 0,0. */
export const WIDE_VIEW: MapView = { center: { lat: 10, lng: 20 }, zoom: 2 };

type Point = { lat: number | null; lng: number | null };

/** The middle of the points that have a position, or null when none do. */
export function centreOf(points: Point[]): { lat: number; lng: number } | null {
  const located = points.filter(
    (p): p is { lat: number; lng: number } => p.lat !== null && p.lng !== null
  );
  if (located.length === 0) return null;
  return {
    lat: located.reduce((n, p) => n + p.lat, 0) / located.length,
    lng: located.reduce((n, p) => n + p.lng, 0) / located.length,
  };
}

/** A regional zoom on the sites' middle, or the wide view. */
export function viewFor(points: Point[]): MapView {
  const c = centreOf(points);
  return c ? { center: c, zoom: 7 } : WIDE_VIEW;
}

let cached: Promise<MapView> | null = null;

/** Drop the cached view at sign-out: it is one company's sites. */
export function forgetSitesView(): void {
  cached = null;
}

/**
 * The company's opening view, read once per page load from its own sites (RLS
 * scopes the read to the caller's company). Coordinates only, no Google call.
 */
export function useSitesView(): MapView | null {
  const [view, setView] = useState<MapView | null>(null);
  useEffect(() => {
    let cancelled = false;
    cached ??= (async () => {
      const { data } = await createClient()
        .from("stores")
        .select("lat, lng")
        .not("lat", "is", null)
        .limit(1000);
      return viewFor((data ?? []) as Point[]);
    })().catch(() => {
      cached = null;
      return WIDE_VIEW;
    });
    void cached.then((v) => !cancelled && setView(v));
    return () => {
      cancelled = true;
    };
  }, []);
  return view;
}
