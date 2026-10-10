"use client";

import { useEffect, useState } from "react";
import { founding } from "@/lib/site";

// How many of the Founding spots are left, asked of the app once per visit
// and shared by every counter on the page. Until the answer comes (or if it
// never does) the page says how many spots there are, never a made-up number
// left.

export type Spots = { total: number; taken: number; left: number };

let pending: Promise<Spots | null> | null = null;

function loadSpots(): Promise<Spots | null> {
  pending ??= fetch(founding.apiUrl, { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? (r.json() as Promise<Partial<Spots>>) : null))
    .then((s) =>
      s && typeof s.total === "number" && typeof s.taken === "number" && typeof s.left === "number"
        ? { total: s.total, taken: s.taken, left: s.left }
        : null,
    )
    .catch(() => null);
  return pending;
}

/** The spots, or null while loading or when the app could not say. */
export function useSpots(): Spots | null {
  const [spots, setSpots] = useState<Spots | null>(null);
  useEffect(() => {
    let live = true;
    void loadSpots().then((s) => {
      if (live) setSpots(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return spots;
}

/** "7 of 10 spots left", or the plain count while the answer is not in, or "All 10 spots are taken". */
export function spotsText(s: Spots | null): string {
  if (!s) return `Only ${founding.spots} spots`;
  if (s.left <= 0) return `All ${s.total} spots are taken`;
  return `${s.left} of ${s.total} spots left`;
}

/** The count as text. Its width changes little, so the page doesn't jump when it arrives. */
export function SpotsText({ className = "" }: { className?: string }) {
  const s = useSpots();
  return (
    <span className={className} aria-live="polite">
      {spotsText(s)}
    </span>
  );
}

/** Ten dots, one for each spot: amber while it is free, hollow once it is taken. */
export function SpotsMeter({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const s = useSpots();
  const total = s?.total ?? founding.spots;
  const left = s?.left ?? null;
  const text = tone === "dark" ? "text-teal-900" : "text-sand";
  const ring = tone === "dark" ? "ring-teal-900/30" : "ring-white/40";
  // Before the app answers, the dots are neither free nor taken.
  const unknown = tone === "dark" ? "bg-teal-900/15" : "bg-white/20";
  return (
    <div className="grid gap-2">
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`size-3.5 rounded-full ring-1 transition-colors duration-500 sm:size-4 ${
              left === null
                ? `${unknown} ring-transparent`
                : i < total - left
                  ? `bg-transparent ${ring}`
                  : "bg-amber-500 ring-amber-500"
            }`}
          />
        ))}
      </div>
      <p className={`font-display text-lg font-bold leading-tight ${text}`} aria-live="polite">
        {spotsText(s)}
      </p>
    </div>
  );
}
