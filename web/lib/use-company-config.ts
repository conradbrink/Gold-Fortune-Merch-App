"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toModuleSet, type ModuleSet } from "@/lib/modules";

/**
 * The signed-in user's company configuration: which modules it has and every
 * setting's effective value (`my_company_config()` in the database).
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
};

type RawConfig = {
  org_id: string;
  modules: Record<string, unknown>;
  settings: CompanySettings;
  timezone: string;
  vat_rate: number | string;
};

export function parseCompanyConfig(raw: unknown): CompanyConfig | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as RawConfig;
  return {
    orgId: r.org_id,
    modules: toModuleSet(r.modules),
    settings: r.settings,
    timezone: r.timezone,
    vatRate: Number(r.vat_rate),
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
