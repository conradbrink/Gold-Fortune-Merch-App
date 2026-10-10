"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
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

/** Bumped by every new request and every refresh; a write needs the latest. */
let generation = 0;

function loadCompanyConfig(): Promise<CompanyConfig | null> {
  if (pending === null) {
    // Each write below checks it still belongs to the current request: a load
    // that started before `refreshCompanyConfig()` must not put the old
    // configuration back in the cache, nor clear a newer request when it fails
    // (CodeRabbit on #74, second pass).
    const request = ++generation;
    pending = (async () => {
      const { data, error } = await createClient().rpc("my_company_config");
      if (error) {
        // Not cached: the next caller tries again rather than inheriting a
        // transient failure for the rest of the session.
        if (generation === request) pending = null;
        throw error;
      }
      const parsed = parseCompanyConfig(data);
      if (generation === request) resolved = parsed;
      return parsed;
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
  // Never on the server. Module state there lives as long as the process, and
  // one process renders every company's pages: the first company seeded was
  // rendered for everyone after it, its name in their sidebar (found in the
  // 10 Oct 2026 audit). The server renders from `CompanyConfigProvider`'s
  // context instead, which belongs to the one request.
  if (typeof window === "undefined") return;
  const parsed = parseCompanyConfig(raw);
  if (parsed === null) return;
  // Already known for this company: kept, as it may be newer than the
  // server's copy after a settings save. A different company means someone
  // else signed in in this tab, and theirs replaces it.
  if (resolved && resolved.orgId === parsed.orgId) return;
  generation++;
  resolved = parsed;
  pending = Promise.resolve(parsed);
}

/** The server's answer for this request, for the first render. */
const SeededConfig = createContext<CompanyConfig | null>(null);

/**
 * Hands the configuration the server layout fetched to every component below,
 * for this request only, and seeds the browser's cache with it.
 */
export function CompanyConfigProvider({
  initialConfig,
  children,
}: Readonly<{ initialConfig: unknown; children?: React.ReactNode }>) {
  const parsed = useMemo(() => parseCompanyConfig(initialConfig), [initialConfig]);
  // Before any child renders, so the sidebar and every page read the
  // company's words and name on their first render. Idempotent.
  seedCompanyConfig(initialConfig);
  return createElement(SeededConfig.Provider, { value: parsed }, children);
}

/**
 * Drop the cached configuration without asking anyone to fetch it again: for
 * sign-out, where there is no session left to fetch with.
 */
export function forgetCompanyConfig(): void {
  generation++;
  pending = null;
  resolved = undefined;
}

/** Forget the cached configuration, so the next reader fetches it again. */
export function refreshCompanyConfig(): void {
  generation++;
  pending = null;
  resolved = undefined;
  for (const listener of listeners) listener();
}

export function useCompanyConfig(): CompanyConfig | null {
  const seeded = useContext(SeededConfig);
  const [config, setConfig] = useState<CompanyConfig | null>(() =>
    typeof window === "undefined" ? seeded : (resolved ?? seeded)
  );

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
