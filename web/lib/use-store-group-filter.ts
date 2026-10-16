"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { storeGroupFromQuery } from "@/lib/dashboard-links";
import {
  fetchStoreGroups,
  resolveStoreGroup,
  storeGroupOf,
  storeGroupWords,
  type StoreGroupChoice,
  type StoreGroupWords,
  type StoreGroups,
} from "@/lib/store-groups";
import type { Terms } from "@/lib/terms";

/** Everything about the page's store group except its rows: what the picker and chip need. */
export type StoreGroupState = StoreGroupWords & {
  choices: StoreGroupChoice[];
  /** The group the page shows: an id, NO_STORE_GROUP, or "" for every group. */
  active: string;
  /** A group was asked for and the groups are still being read: the page is not ready. */
  loading: boolean;
  /** A group was asked for and the groups could not be read: every row is shown. */
  failed: boolean;
  /** A group was asked for that the company does not have (any more): every row is shown. */
  missing: boolean;
  choose: (next: string) => void;
  /** Reads the groups again, after `failed`. */
  retry: () => void;
};

export type StoreGroupFilter<T> = StoreGroupState & {
  /** The page's rows in the chosen group, or all of them. */
  rows: T[];
};

/**
 * One store group for a whole page, kept in the address (`?group=`) so a
 * reload, a shared link or Back opens the same group. `key` names the field
 * that holds each row's store id. `onChoose` clears the page's own filters
 * (a person, a town) when the group changes, as choosing a tile does, so one
 * hidden under the old group does not come back under the next.
 *
 * Groups that cannot be read cost only the filter: every row is shown, with
 * `failed` to say so and `retry` to read them again. A page counts `loading`
 * as its own, so a link that names a group never shows every group first.
 */
export function useStoreGroupFilter<K extends string, T extends { [P in K]: string | null }>(
  rows: T[],
  t: Terms,
  { key, onChoose }: { key: K; onChoose?: () => void }
): StoreGroupFilter<T> {
  const [chosen, setChosen] = useState("");
  /** The groups; "failed" when they could not be read; null while reading. */
  const [read, setRead] = useState<StoreGroups | "failed" | null>(null);
  const [tries, setTries] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only: the picker owns the choice from here.
    setChosen(storeGroupFromQuery(new URLSearchParams(window.location.search)));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let stale = false;
    fetchStoreGroups(createClient())
      .then((g) => {
        if (!stale) setRead(g);
      })
      .catch(() => {
        if (!stale) setRead("failed");
      });
    return () => {
      stale = true;
    };
  }, [tries]);

  const groups = read !== null && read !== "failed" ? read : null;
  const storeIds = useMemo(() => rows.map((r) => r[key]), [rows, key]);
  const view = useMemo(
    () => (groups ? resolveStoreGroup(chosen, storeIds, groups, t) : { choices: [], active: "", missing: false }),
    [chosen, storeIds, groups, t]
  );
  const name = view.choices.find((g) => g.id === view.active)?.name ?? "";
  const inStoreGroup = useMemo(
    () => (view.active === "" || !groups ? rows : rows.filter((r) => storeGroupOf(r[key], groups.groupOf) === view.active)),
    [rows, key, groups, view.active]
  );

  function choose(next: string) {
    setChosen(next);
    onChoose?.();
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("group", next);
    else url.searchParams.delete("group");
    window.history.replaceState(null, "", url);
  }

  function retry() {
    setRead(null);
    setTries((n) => n + 1);
  }

  return {
    ...storeGroupWords(view.active, name, t),
    choices: view.choices,
    active: view.active,
    loading: chosen !== "" && read === null,
    failed: chosen !== "" && read === "failed",
    missing: view.missing,
    rows: inStoreGroup,
    choose,
    retry,
  };
}
