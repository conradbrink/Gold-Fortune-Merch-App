"use client";

import Script from "next/script";
import { metaPixelId } from "@/lib/site";

// The Meta (Facebook) Pixel, on /founding only. The ID lives in lib/site.ts
// (`metaPixelId`); while it is empty nothing loads and nothing is sent. It
// counts the page view, and the form fires a "Lead" when an application is sent.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

// A Pixel ID is digits. Anything else is treated as not set, so a typo in the
// setting can never put script text on the page.
const pixelId = /^\d{5,20}$/.test(metaPixelId) ? metaPixelId : "";

export function MetaPixel() {
  if (!pixelId) return null;
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`}
    </Script>
  );
}

/** Tell Meta an application was sent. Does nothing without a Pixel. */
export function trackLead() {
  if (pixelId) window.fbq?.("track", "Lead");
}
