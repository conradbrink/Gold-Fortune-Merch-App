"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchStoreGroups,
  storeGroupChoices,
  storeGroupOf,
  storeGroupWords,
  type StoreGroupChoice,
  type StoreGroupWords,
  type StoreGroups,
} from "@/lib/store-groups";
import type { Terms } from "@/lib/terms";

export type StoreGroupFilter<T> = StoreGroupWords & {
  choices: StoreGroupChoice[];
  /** The chosen group's id, NO_STORE_GROUP, or "" for every group. */
  active: string;
  /** The page's rows in the chosen group, or all of them. */
  rows: T[];
  choose: (next: string) => void;
  /** A link asked for a group, and the groups could not be read to show it. */
  failed: boolean;
};

/**
 * One store group for a whole page, kept in the address (`?group=`) so a
 * reload, a shared link or Back opens the same group. Reading the groups again
 * with `attempt` (the page's Try again). Groups that cannot be read cost only
 * the filter: every row is shown, and `failed` says so when a group was asked
 * for.
 */
export function useStoreGroupFilter<T extends { store_id: string }>(rows: T[], t: Terms, attempt = 0): StoreGroupFilter<T> {
  const [groups, setGroups] = useState<StoreGroups | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [chosen, setChosen] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Mount only: the picker owns the choice from here.
    setChosen(new URLSearchParams(window.location.search).get("group") ?? "");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let stale = false;
    fetchStoreGroups(createClient())
      .then((g) => {
        if (stale) return;
        setGroups(g);
        setUnreadable(false);
      })
      .catch(() => {
        if (stale) return;
        setGroups(null);
        setUnreadable(true);
      });
    return () => {
      stale = true;
    };
  }, [attempt]);

  const choices = useMemo(() => (groups ? storeGroupChoices(rows, groups, t) : []), [rows, groups, t]);
  const active = choices.some((g) => g.id === chosen) ? chosen : "";
  const name = choices.find((g) => g.id === active)?.name ?? "";
  const inGroup = useMemo(
    () => (active === "" || !groups ? rows : rows.filter((r) => storeGroupOf(r.store_id, groups.groupOf) === active)),
    [rows, groups, active]
  );

  function choose(next: string) {
    setChosen(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("group", next);
    else url.searchParams.delete("group");
    window.history.replaceState(null, "", url);
  }

  return {
    ...storeGroupWords(active, name, t),
    choices,
    active,
    rows: inGroup,
    choose,
    failed: unreadable && chosen !== "",
  };
}
