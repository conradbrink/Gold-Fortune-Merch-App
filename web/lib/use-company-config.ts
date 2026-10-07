"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";
import type { Branding } from "@/lib/branding";
import { parseCompanyConfig, type CompanyConfig } from "@/lib/company-config";

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

// The payload's shape and parser live in a module without "use client", so
// server code can parse what it fetched too. Re-exported so nothing that
// imports them from here has to change.
export { parseCompanyConfig } from "@/lib/company-config";
export type { CompanyConfig, CompanySettings } from "@/lib/company-config";

let pending: Promise<CompanyConfig | null> | null = null;
/** The answer once known, so a component mounting later starts with it. */
let resolved: CompanyConfig | null | undefined;
/**
 * Every mounted `useCompanyConfig`, told when the cache is dropped so it
 * fetches again: after the settings page saves new words or a new logo, the
 * sidebar already on screen must show them, not wait for a navigation.
 */
const listeners = new Set<() => void>();

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
  for (const listener of listeners) listener();
}

export function useCompanyConfig(): CompanyConfig | null {
  const [config, setConfig] = useState<CompanyConfig | null>(resolved ?? null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
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
    };
    load();
    listeners.add(load);
    return () => {
      cancelled = true;
      listeners.delete(load);
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
