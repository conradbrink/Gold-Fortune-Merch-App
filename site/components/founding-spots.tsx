"use client";

import { useEffect, useState } from "react";
import { founding } from "@/lib/site";

// How many of the Founding spots are left. It is one number the owner sets by
// hand in the database when they pick someone; the page asks the app for it
// once per visit. Until the answer comes (or if it never does) the page says
// how many spots there are, never a made-up number left.

let pending: Promise<number | null> | null = null;

function loadSpotsLeft(): Promise<number | null> {
  pending ??= fetch(founding.apiUrl, { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? (r.json() as Promise<{ left?: unknown }>) : null))
    .then((s) => (s && typeof s.left === "number" && Number.isFinite(s.left) ? Math.max(Math.floor(s.left), 0) : null))
    .catch(() => null);
  return pending;
}

/** The spots left, or null while loading or when the app could not say. */
export function useSpotsLeft(): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void loadSpotsLeft().then((n) => {
      if (live) setLeft(n);
    });
    return () => {
      live = false;
    };
  }, []);
  return left;
}

/** "10 of 10 spots left", or "Only 10 spots" while the answer is not in, or "All 10 spots are taken". */
export function spotsText(left: number | null): string {
  if (left === null) return `Only ${founding.spots} spots`;
  if (left <= 0) return `All ${founding.spots} spots are taken`;
  return `${Math.min(left, founding.spots)} of ${founding.spots} spots left`;
}

export function SpotsText({ className = "" }: { className?: string }) {
  const left = useSpotsLeft();
  return (
    <span className={className} aria-live="polite">
      {spotsText(left)}
    </span>
  );
}
