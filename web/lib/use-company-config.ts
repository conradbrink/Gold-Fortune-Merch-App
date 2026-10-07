"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toModuleSet, type ModuleSet } from "@/lib/modules";
import { DEFAULT_TERMS, parseTerms, type Terms } from "@/lib/terms";
import { parseBranding, type Branding } from "@/lib/branding";

/**
 * The signed-in user's company configuration: which modules it has, every
 * setting's effective value, its words for things and its branding
 * (`my_company_config()` in the database).
 *
 * Same contract as `usePermissions`: `null` while it loads or if the lookup
 * failed, and callers render nothing module-dependent until it resolves —
 * flashing a menu without the warehouse at a company that has one would be a
 * wrong answer, not a missing one.
 *
 * One request per page load, however many components ask: the sidebar, the
 * top bar and the dashboard all mount at once, and each asking separately would
 * triple a call that cannot change between them. `refreshCompanyConfig` drops
 * the cached answer after the settings page saves.
 *
 * The dashboard layout fetches the configuration on the server and seeds this
 * cache (`seedCompanyConfig`) before any client component renders, so the
 * company's words, colours and name are there on the first paint rather than
 * flickering in from the defaults.
 *
 * Chrome, not access control: `proxy.ts` and the database's module gates
 * decide what is served and read.
 */

export type CompanySettings = {
  gps_ping_interval_minutes: number;
  short_visit_minutes: number;
  auto_end_enabled: boolean;
  auto_end_time: string;
  checkin_radius_m: number;
  off_site_distance_m: number;
  invalid_gps_distance_m: number;
  currency_code: string;
};

export type CompanyConfig = {
  orgId: string;
  modules: ModuleSet;
  settings: CompanySettings;
  timezone: string;
  vatRate: number;
  terms: Terms;
  branding: Branding;
};

/**
 * The setting definitions' own defaults (`setting_definitions.default_value`),
 * used only for a field the payload is missing or got wrong. The database
 * always sends every key; this is for a payload that is not what it should
 * be, which must not reach the screens as `undefined`.
 */
const SETTING_FALLBACK: CompanySettings = {
  gps_ping_interval_minutes: 5,
  short_visit_minutes: 5,
  auto_end_enabled: true,
  auto_end_time: "19:30",
  checkin_radius_m: 100,
  off_site_distance_m: 500,
  invalid_gps_distance_m: 5000,
  currency_code: "BWP",
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function int(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) ? v : fallback;
}

/** The RPC payload, checked field by field rather than asserted. */
export function parseCompanyConfig(raw: unknown): CompanyConfig | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.org_id !== "string") return null;
  const s = obj(r.settings);
  const f = SETTING_FALLBACK;
  return {
    orgId: r.org_id,
    modules: toModuleSet(obj(r.modules)),
    settings: {
      gps_ping_interval_minutes: int(s.gps_ping_interval_minutes, f.gps_ping_interval_minutes),
      short_visit_minutes: int(s.short_visit_minutes, f.short_visit_minutes),
      auto_end_enabled:
        typeof s.auto_end_enabled === "boolean" ? s.auto_end_enabled : f.auto_end_enabled,
      auto_end_time:
        typeof s.auto_end_time === "string" && /^\d{2}:\d{2}$/.test(s.auto_end_time)
          ? s.auto_end_time
          : f.auto_end_time,
      checkin_radius_m: int(s.checkin_radius_m, f.checkin_radius_m),
      off_site_distance_m: int(s.off_site_distance_m, f.off_site_distance_m),
      invalid_gps_distance_m: int(s.invalid_gps_distance_m, f.invalid_gps_distance_m),
      currency_code:
        typeof s.currency_code === "string" && /^[A-Z]{3}$/.test(s.currency_code)
          ? s.currency_code
          : f.currency_code,
    },
    timezone: typeof r.timezone === "string" && r.timezone !== "" ? r.timezone : "UTC",
    vatRate: Number.isFinite(Number(r.vat_rate)) ? Number(r.vat_rate) : 0,
    terms: parseTerms(r.terms),
    branding: parseBranding(r.branding),
  };
}

let pending: Promise<CompanyConfig | null> | null = null;
/** The answer once known, so a component mounting later starts with it. */
let resolved: CompanyConfig | null | undefined;

function loadCompanyConfig(): Promise<CompanyConfig | null> {
  if (pending === null) {
    pending = (async () => {
      const { data, error } = await createClient().rpc("my_company_config");
      if (error) {
        // Not cached: the next caller tries again rather than inheriting a
        // transient failure for the rest of the session.
        pending = null;
        throw error;
      }
      resolved = parseCompanyConfig(data);
      return resolved;
    })();
  }
  return pending;
}

/**
 * The same answer outside React, for data loaders that need a setting (the
 * company's timezone, say) before they can shape their rows.
 */
export function getCompanyConfig(): Promise<CompanyConfig | null> {
  return loadCompanyConfig();
}

/**
 * Put the server's answer in the cache before anything renders. Called by the
 * dashboard shell with the payload the server layout fetched; a payload that
 * does not parse leaves the cache alone, so the client fetches as before.
 */
export function seedCompanyConfig(raw: unknown): void {
  if (resolved !== undefined) return;
  const parsed = parseCompanyConfig(raw);
  if (parsed === null) return;
  resolved = parsed;
  pending = Promise.resolve(parsed);
}

/** Forget the cached configuration, so the next reader fetches it again. */
export function refreshCompanyConfig(): void {
  pending = null;
  resolved = undefined;
}

export function useCompanyConfig(): CompanyConfig | null {
  const [config, setConfig] = useState<CompanyConfig | null>(resolved ?? null);

  useEffect(() => {
    let cancelled = false;
    loadCompanyConfig().then(
      (value) => {
        if (!cancelled) setConfig(value);
      },
      (error) => {
        console.error(
          "useCompanyConfig: the lookup failed, so no module-dependent chrome will render.",
          error
        );
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

/**
 * The company's words, the neutral defaults until the configuration is known.
 * Unlike modules, a default word is a fine placeholder: it is never a wrong
 * answer about what the company may do.
 */
export function useTerms(): Terms {
  return useCompanyConfig()?.terms ?? DEFAULT_TERMS;
}

/** The company's branding, or null until the configuration is known. */
export function useBranding(): Branding | null {
  return useCompanyConfig()?.branding ?? null;
}
