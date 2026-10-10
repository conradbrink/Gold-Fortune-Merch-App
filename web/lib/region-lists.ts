"use client";

import { useSyncExternalStore } from "react";

/**
 * What only the browser knows: every country and currency it can name, the
 * person's own country (from the browser's language) and timezone. Read
 * through useSyncExternalStore, so the server render and the first client
 * render agree (empty) and the lists fill in once hydrated. Nothing here is a
 * list in our code.
 */
export type BrowserLists = {
  countries: { code: string; name: string }[];
  currencies: { code: string; name: string }[];
  country: string;
  zone: string;
  zones: string[];
};
const NO_LISTS: BrowserLists = { countries: [], currencies: [], country: "", zone: "", zones: [] };

/**
 * A code the browser names but ISO 3166-1 does not give to a country: the
 * user-assigned ranges (AA, QM–QZ, XA–XZ, ZZ — the browser names XA "Pseudo-
 * Accents" and ZZ "Unknown Region") and the exceptionally reserved codes (EU,
 * UN, Ceuta, Canary Islands…). Kosovo's XK is user-assigned but in general use,
 * so it stays. This is the standard's own rule, not a list of countries.
 */
function notACountry(code: string): boolean {
  if (code === "XK") return false;
  if (code === "AA" || code === "ZZ" || code[0] === "X") return true;
  if (code[0] === "Q" && code[1] >= "M") return true;
  return ["AC", "CP", "DG", "EA", "EU", "EZ", "IC", "TA", "UN"].includes(code);
}
let browserLists: BrowserLists | null = null;
function readBrowserLists(): BrowserLists {
  if (browserLists) return browserLists;
  const regionNames = new Intl.DisplayNames(undefined, { type: "region" });
  const currencyNames = new Intl.DisplayNames(undefined, { type: "currency" });
  const countries: { code: string; name: string }[] = [];
  const A = "A".charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j);
      if (notACountry(code)) continue;
      try {
        const name = regionNames.of(code);
        // An unassigned code comes back as itself. A retired code (DD, SU,
        // UK…) canonicalises to its successor, so keeping only codes that are
        // their own canonical form lists each country once.
        if (name && name !== code && new Intl.Locale(`und-${code}`).region === code) countries.push({ code, name });
      } catch {
        // Not a region code this browser knows.
      }
    }
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));
  const supported = typeof Intl.supportedValuesOf === "function";
  const currencies = (supported ? Intl.supportedValuesOf("currency") : [])
    .map((code) => ({ code, name: currencyNames.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  let country = "";
  try {
    country = new Intl.Locale(navigator.language).maximize().region ?? "";
  } catch {
    country = "";
  }
  browserLists = {
    countries,
    currencies,
    country: countries.some((c) => c.code === country) ? country : "",
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    zones: supported ? Intl.supportedValuesOf("timeZone") : [],
  };
  return browserLists;
}
const neverChanges = () => () => {};

/**
 * The browser's country, currency and timezone lists, for the sign-up form
 * and Company settings. Empty on the server and on the first client render,
 * then filled in.
 */
export function useRegionLists(): BrowserLists {
  return useSyncExternalStore(neverChanges, readBrowserLists, () => NO_LISTS);
}
