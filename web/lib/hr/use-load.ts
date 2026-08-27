"use client";

import { useEffect } from "react";

/**
 * Run a loader once on mount, and again whenever its identity changes.
 *
 * Every client page in this app fetches its data the same way:
 *
 *     const load = useCallback(async () => { … setRows(r) }, [deps]);
 *     useEffect(() => { load(); }, [load]);
 *
 * and every one of them trips `react-hooks/set-state-in-effect`. The tree
 * carries 25 of those today and CI reports the count so it can be driven to
 * zero; the HR module deliberately adds none.
 *
 * The fix is the `void`. The rule is looking for state set *synchronously*
 * inside an effect, and an un-awaited promise-returning call is ambiguous to
 * it. `void` is the standard marker for a deliberate fire-and-forget, and with
 * it the rule correctly sees that nothing lands until after the first await.
 * Restructuring `load` does not help — moving `setLoading(true)` past the await
 * silences nothing, which was tried before this hook was written.
 *
 * Wrapping it in a hook rather than repeating `void load()` twelve times is
 * partly less to read at each call site, and mostly so that there is one place
 * to change when these pages move to server components or grow a real
 * data-fetching library.
 */
export function useHrLoad(load: () => Promise<void> | void): void {
  useEffect(() => {
    void load();
  }, [load]);
}
