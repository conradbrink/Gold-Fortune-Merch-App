"use client";

import { useEffect } from "react";
import Script from "next/script";
import { gaMeasurementId } from "@/lib/site";
import { rememberFirstVisit } from "@/lib/first-visit";

// Google Analytics 4 for the whole site. The Measurement ID lives in
// lib/site.ts (`gaMeasurementId`); while it is empty nothing loads and nothing
// is sent. Page views are counted by Google itself (including the moves
// between pages, through "page changes based on browser history" in the
// property's enhanced measurement). Ad features are switched off: Tickd uses it
// to count visits, not to advertise to visitors.
//
// The events the funnel needs are sent with `track`. Names follow the owner's
// spec (pricing_view, feature_view, signup_started, signup_completed); a new
// one is just a new name, nothing to register in code.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

// A Measurement ID is "G-" and letters or digits. Anything else is treated as
// not set, so a typo in the setting can never put script text on the page.
const measurementId = /^G-[A-Z0-9]{4,20}$/.test(gaMeasurementId) ? gaMeasurementId : "";

export function Analytics() {
  useEffect(() => rememberFirstVisit(), []);
  if (!measurementId) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config','${measurementId}',{allow_google_signals:false,allow_ad_personalization_signals:false});`}
      </Script>
    </>
  );
}

/** Sends one event to Google Analytics. Does nothing while GA is not set up. */
export function track(name: string, params: Record<string, string | number | boolean> = {}): void {
  if (!measurementId) return;
  try {
    window.gtag?.("event", name, params);
  } catch {
    /* analytics must never break the page */
  }
}

/**
 * Sends an event the first time each named section reaches the middle of the
 * screen (a band, so a section taller than the screen still counts), once
 * per page load: `pricing_view` for the prices, `feature_view` (with the
 * section's id) for the parts that explain what Tickd does.
 */
export function SectionViews({ sections }: { sections: Record<string, string> }) {
  useEffect(() => {
    if (!measurementId || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (!entry.isIntersecting || seen.has(id)) continue;
          seen.add(id);
          observer.unobserve(entry.target);
          const event = sections[id];
          track(event, event === "feature_view" ? { section: id } : {});
        }
      },
      { rootMargin: "-40% 0px -40% 0px" }
    );
    for (const id of Object.keys(sections)) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);
  return null;
}
