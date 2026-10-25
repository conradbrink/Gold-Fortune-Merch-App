"use client";

import { useEffect, useRef } from "react";

/**
 * Telling an open page that the AI Manager just changed something on it.
 *
 * The chat floats over the page, so the dashboard, form or promotion behind it
 * is still showing what it loaded before the button was pressed. The panel
 * announces the page the change belongs to, and a page that listens reads its
 * data again, so the person sees the change land where they are looking.
 */

const EVENT = "tickd:assistant-changed";

export function announceChange(href: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { href } }));
}

/** Calls `reload` when a change lands on this page or one under it ("/forms" hears "/forms/abc"). */
export function useAssistantChanged(page: string, reload: () => void) {
  // The newest `reload`, without listening again on every render.
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => {
    function heard(event: Event) {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href ?? "";
      const path = href.split(/[?#]/)[0];
      // The dashboard is "/", which every page starts with: only itself.
      if (path === page || (page !== "/" && path.startsWith(`${page}/`))) latest.current();
    }
    window.addEventListener(EVENT, heard);
    return () => window.removeEventListener(EVENT, heard);
  }, [page]);
}
